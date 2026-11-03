#!/usr/bin/env python3
"""PreToolUse hook: block commands aimed at Curio's production environment.

For Bash and MCP tool calls, blocks:
- anything that names a production identifier listed in production-targets.txt
  (the production Supabase project ref, and the production domain once it exists);
- Supabase CLI commands that act on a remote project while that project is
  production, and every one of them until a production ref is listed (fail closed);
- Supabase commands that print secret keys into the session, and CLI versions
  other than the pinned CLI 3, whose commands this hook doesn't know;
- Vercel production deployments, promotions, removals and production settings;
- GitHub workflow runs, secrets, variables or API calls aimed at production, and
  deployment approvals however they're sent;
- environment variables named PROD or PRODUCTION, which hide connection strings;
- Stripe live mode (Curio uses the Stripe sandbox only).

Commands are read the way a shell reads them, as far as a hook can: line
continuations (read both joined and not, as a comment can end in a backslash),
`;`, `&&` and pipes, shell keywords, launchers such as `pnpm exec`, the strings
given to `bash -c` or `eval`, command substitutions, and heredocs that feed a
shell. A line that won't parse is split on its operators instead, so nothing on
it goes unread. A script file can't be seen into, so a remote command never goes
in one (.claude/rules/database.md). If the hook itself fails, it blocks.

Exit code 2 blocks the tool call; the message on stderr goes back to Claude.
"""

import json
import os
import re
import shlex
import sys
from collections import namedtuple
from urllib.parse import urlparse

TARGETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "production-targets.txt")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}
# Words that can come before a CLI name, as in `npx supabase`, `pnpm exec vercel` or `do supabase`.
LAUNCHERS = {"npx", "pnpx", "bunx", "pnpm", "yarn", "npm", "exec", "dlx", "sudo", "env", "time", "command",
             "nohup", "nice", "xargs", "if", "then", "elif", "else", "do", "while", "until", "!", "{"}
# Shells whose `-c` string is a command in its own right; `eval`'s arguments are too.
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "csh", "tcsh", "fish"}
# Commands that never run their arguments, so a CLI name after them is just a word.
READ_ONLY = {"echo", "printf", "grep", "egrep", "fgrep", "rg", "ugrep", "ls", "cat", "head", "tail", "less",
             "more", "wc", "git", "which", "type", "man", "file", "stat", "tree", "jq", "cd", "pwd"}
# Flags that move a command into another folder, as in `pnpm -C <dir>` or `npm --prefix <dir>`.
FOLDER_FLAGS = {"-C", "--dir", "--prefix", "--cwd"}

# Supabase CLI 3's commands, so `dotenvx run -- supabase db push` is still seen as a call.
SUPABASE_COMMANDS = {
    "backups", "bootstrap", "branches", "completion", "config", "db", "domains", "encryption", "feedback",
    "functions", "gen", "init", "inspect", "issue", "link", "login", "logout", "migration", "migrations",
    "network-bans", "network-restrictions", "notebooks", "orgs", "postgres-config", "projects", "pull",
    "secrets", "seed", "services", "snippets", "ssl-enforcement", "sso", "start", "status", "stop", "storage",
    "telemetry", "test", "unlink", "vanity-subdomains", "whoami",
}
# Supabase CLI commands that only touch the local stack or local files.
SUPABASE_LOCAL = {"start", "stop", "status", "init", "help", "completion", "login", "logout", "test", "services", "unlink"}
# Where the subcommand decides. Anything not listed counts as remote.
SUPABASE_LOCAL_SUB = {
    "db": {"start", "reset", "diff", "lint"},
    "migration": {"new"},
    "functions": {"serve", "new"},
    "gen": {"signing-key", "bearer-jwt", "types"},
    "projects": {"list"},
    "orgs": {"list"},
}
SUPABASE_TARGET_FLAGS = {"--project-ref", "--project-id", "--db-url"}
SUPABASE_VALUE_FLAGS = {"--workdir", "--profile", "-o", "--output", "--network-id", "--dns-resolver",
                        "--output-format", "--log-level", "--agent"}
HELP = {"--help", "-h"}
REF_SHAPE = re.compile(r"[a-z]{20}")
URL_SHAPE = re.compile(r"[a-z][a-z0-9+.-]*://", re.I)
GH_SENSITIVE = {"workflow", "run", "secret", "variable", "api", "environment", "deployment"}
GH_ENVIRONMENTS = re.compile(r"/environments\b")
# Approving or rejecting a deployment, through REST or GraphQL, with gh, curl or anything else.
APPROVALS = re.compile(r"approveDeployments|rejectDeployments|pending_deployments|deployment_protection_rule", re.I)
# A shell redirection such as `>`, `2>` or `2>/dev/null`. A bare operator takes the next word.
REDIRECT = re.compile(r"\d*(?:>>?|<<?|&>)")
HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1")
SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
# A word the shell would expand, or a placeholder or pattern, so the hook can't know its value.
UNRESOLVED = re.compile(r"[$`]")
UNKNOWN = re.compile(r"[$`{}*?\[\]]")

Parsed = namedtuple("Parsed", "flags bare words target target_flag workdir")


def load_targets():
    try:
        with open(TARGETS_FILE, encoding="utf-8") as f:
            lines = (line.strip().lower() for line in f)
            return [line for line in lines if line and not line.startswith("#")]
    except FileNotFoundError:
        return []


def block(reason):
    print(f"Blocked: {reason} Production changes go through CI with a manual approval.", file=sys.stderr)
    sys.exit(2)


def without_heredocs(text):
    """Drop heredoc bodies, which are data, unless the command reading them is a shell."""
    kept, delimiter = [], None
    for line in text.splitlines():
        if delimiter is not None:
            if line.strip() == delimiter:
                delimiter = None
            continue
        kept.append(line)
        match = HEREDOC.search(line)
        if match and not any(os.path.basename(w).lower() in SHELLS for w in line.split()):
            delimiter = match.group(2)
    return "\n".join(kept)


def split_line(line):
    """Split one line into simple commands at ; && || | & ( )."""
    lexer = shlex.shlex(line, posix=True, punctuation_chars=";&|()")
    lexer.whitespace_split = True
    lexer.commenters = ""
    parts, current = [], []
    try:
        for token in lexer:
            if token and set(token) <= set(";&|()"):
                if current:
                    parts.append(current)
                current = []
            else:
                current.append(token)
    except ValueError:
        # An unmatched quote, often an apostrophe in a comment: split on the operators instead.
        pieces = (piece.split() for piece in re.split(r"[;&|()]+", line))
        return [words for words in ([w.strip("'\"") for w in piece if w.strip("'\"")] for piece in pieces) if words]
    if current:
        parts.append(current)
    return parts


def segments(command):
    """Split a shell command into simple commands, reading line continuations both joined and not."""
    parts = []
    for text in {command, command.replace("\\\n", "")}:
        for line in without_heredocs(text).splitlines():
            parts += split_line(line)
    return parts


def cli_name(token):
    """The program a word names, as in `node_modules/.bin/supabase` or `supabase@3`. macOS ignores case."""
    return os.path.basename(token).split("@")[0].lower()


def is_launcher(token):
    return os.path.basename(token).lower() in LAUNCHERS or re.fullmatch(r"\w+=.*", token) is not None


def nested(seg):
    """Command strings inside a simple command: the string after `bash -c` (or `-lc`), and `eval`'s arguments."""
    for i, token in enumerate(seg):
        word = os.path.basename(token).lower()
        if word == "eval":
            return [" ".join(seg[i + 1 :])]
        if word in SHELLS:
            for j in range(i + 1, len(seg) - 1):
                if seg[j].startswith("-") and not seg[j].startswith("--") and "c" in seg[j]:
                    return [seg[j + 1]]
            return []
    return []


def launched(seg, name):
    """(word, arguments) when the simple command runs `name`, perhaps through launchers and their flags."""
    after_flag = False
    for i, token in enumerate(seg):
        if cli_name(token) == name:
            following = seg[i + 1] if i + 1 < len(seg) else ""
            if after_flag and cli_name(following) == name:
                after_flag = False  # a package name, as in `npx --package supabase supabase`
                continue
            return token, without_redirects(seg[i + 1 :])
        if token.startswith("-"):
            after_flag = True
        elif REDIRECT.match(token):
            after_flag = REDIRECT.fullmatch(token) is not None
        elif is_launcher(token) or after_flag:
            after_flag = False
        else:
            return None
    return None


def first_word(args):
    """The first word of a command's arguments, after any flags and the values of Supabase's value flags."""
    skip = False
    for arg in args:
        if skip:
            skip = False
        elif arg.startswith("-"):
            skip = "=" not in arg and arg in SUPABASE_TARGET_FLAGS | SUPABASE_VALUE_FLAGS
        else:
            return arg
    return None


def loose(seg, name):
    """(word, arguments) when `name` appears later with a command after it, as in `dotenvx run -- supabase db`.

    A command that only prints or searches words, such as `echo` or `grep`, never counts. For the
    Supabase CLI, the first word after its flags must be one of its commands, so `find supabase -name x`
    or `pnpm ls supabase --depth 0` aren't mistaken for calls.
    """
    if not seg or os.path.basename(seg[0]).lower() in READ_ONLY:
        return None
    for i in range(1, len(seg) - 1):
        if cli_name(seg[i]) == name and (name != "supabase" or first_word(seg[i + 1 :]) in SUPABASE_COMMANDS):
            return seg[i], without_redirects(seg[i + 1 :])
    return None


def calls(command, name):
    """Yield (word, arguments) for each call to the CLI `name` in a shell command, nested ones included."""
    for match in SUBSTITUTION.finditer(without_heredocs(command)):
        yield from calls(match.group(1) or match.group(2) or "", name)
    for seg in segments(command):
        for inner in nested(seg):
            yield from calls(inner, name)
        found = launched(seg, name) or loose(seg, name)
        if found:
            yield found


def invocations(command, name):
    """Yield the arguments of each call to the CLI `name` in a shell command."""
    for _, args in calls(command, name):
        yield args


def without_redirects(args):
    """Drop shell redirections, such as `2>&1` or `> types.ts`, from a command's arguments."""
    kept, skip = [], False
    for arg in args:
        if skip:
            skip = False
        elif REDIRECT.match(arg):
            skip = REDIRECT.fullmatch(arg) is not None
        else:
            kept.append(arg)
    return kept


def parse_supabase(args):
    """Split `supabase <args>` into its flags (and those given with no `=value`), words, target and --workdir."""
    flags, bare, words = set(), set(), []
    target = target_flag = workdir = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("-"):
            name, eq, value = arg.partition("=")
            flags.add(name)
            if not eq:
                bare.add(name)
            if name == "--remote":
                # CLI 3: bare `--remote` is the linked project; a target needs `--remote=<ref|branch|url>`.
                if value:
                    target, target_flag = value, name
            elif name in SUPABASE_TARGET_FLAGS | SUPABASE_VALUE_FLAGS:
                if not eq and i + 1 < len(args):
                    i += 1
                    value = args[i]
                if name in SUPABASE_TARGET_FLAGS:
                    target, target_flag = value, name
                elif name == "--workdir":
                    workdir = value
        else:
            words.append(arg)
        i += 1
    return Parsed(flags, bare, words, target, target_flag, workdir)


def supabase_target(p):
    """Return (acts_on_a_remote_project, explicit_target) for a parsed Supabase command."""
    if p.bare & HELP and p.flags <= HELP:
        return False, None  # help on its own; `--help=false`, or help after `--`, runs the command
    if p.target is not None:
        if p.target_flag in ("--db-url", "--remote") and is_local_url(p.target):
            return False, None
        return True, p.target
    if p.flags & {"--linked", "--remote"}:
        return True, None
    if "--local" in p.bare or not p.words:
        return False, None
    command, sub = p.words[0], (p.words[1] if len(p.words) > 1 else "")
    if command in SUPABASE_LOCAL or sub in SUPABASE_LOCAL_SUB.get(command, set()):
        return False, None
    return True, None


def is_local_url(value):
    """True only for a URL with one local host, so `host1,host2` or `?host=` can't slip a remote one in."""
    try:
        url = urlparse(value)
        host = url.hostname or ""
    except ValueError:
        return False
    if "," in url.netloc or "host=" in url.query.lower():
        return False
    return host in LOCAL_HOSTS


def workdirs(command, workdir, cwd):
    """Folders the CLI might read its link from, and whether any of them is unknown.

    These are --workdir, SUPABASE_WORKDIR, `cd` and `pushd` (after any launchers or keywords),
    and launcher folder flags such as `pnpm -C`. A SUPABASE_* setting taken from a variable is unknown.
    """
    found = [workdir] if workdir else []
    pending = [command]
    while pending:
        for seg in segments(pending.pop()):
            pending += nested(seg)
            words = [t for t in seg if not is_launcher(t)]
            if words and words[0] in ("cd", "pushd"):
                args = words[1:]
                dirs = [a for a in args if not a.startswith("-")]
                found.append(dirs[-1] if dirs else ("-" if "-" in args else "~"))
            for i, token in enumerate(seg):
                name, eq, value = token.partition("=")
                if name in FOLDER_FLAGS:
                    found += [value] if eq else seg[i + 1 : i + 2]
                elif name == "SUPABASE_WORKDIR" or (name.startswith("SUPABASE_") and UNRESOLVED.search(value)):
                    found.append(value)
    unresolved = any(UNRESOLVED.search(d) or d == "-" for d in found)
    base = cwd or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    return [os.path.join(base, os.path.expanduser(d)) for d in found], unresolved


def linked_refs(payload, extra_dirs=()):
    """Project refs the Supabase CLI could use, from each folder in the command and the working directory upwards."""
    refs, seen = set(), set()
    for start in list(extra_dirs) + [payload.get("cwd"), os.environ.get("CLAUDE_PROJECT_DIR")]:
        d = os.path.abspath(start) if start else None
        while d and d not in seen:
            seen.add(d)
            try:
                with open(os.path.join(d, "supabase", ".temp", "project-ref"), encoding="utf-8") as f:
                    refs.add(f.read().strip().lower())
            except OSError:
                pass
            parent = os.path.dirname(d)
            d = parent if parent != d else None
    return refs


def check_bash(command, targets, payload):
    lowered = command.lower()
    hit = next((t for t in targets if t in lowered), None)
    if hit:
        block(f"the command names the production target '{hit}' (.claude/hooks/production-targets.txt).")

    for match in re.finditer(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)", command):
        if {"PROD", "PRODUCTION"} & set(match.group(1).upper().split("_")):
            block(f"the command uses {match.group(0)}, which looks like a production setting.")

    if APPROVALS.search(command):
        block("the command approves or rejects a deployment, or changes a deployment rule. Do that in the browser.")

    if re.search(r"\b(?:sk|rk)_live_", command):
        block("the command contains a live Stripe key. Curio uses the Stripe sandbox only.")
    for args in invocations(command, "stripe"):
        if any(a.split("=")[0] == "--live" for a in args):
            block("the Stripe CLI is in live mode. Curio uses the Stripe sandbox only.")

    for args in invocations(command, "vercel"):
        words = [a.lower() for a in args if not a.startswith("-")]
        if any(a.split("=")[0] in ("--prod", "--production") for a in args) \
                or (words and words[0] in ("promote", "rollback", "alias", "remove", "rm")) \
                or (words[:1] in (["project"], ["projects"]) and words[1:2] in (["rm"], ["remove"])) \
                or "production" in words or any(a.lower().endswith("=production") for a in args):
            block("the Vercel command targets production, or removes deployments or projects.")

    for args in invocations(command, "gh"):
        if args and args[0] in GH_SENSITIVE and re.search(r"prod", " ".join(args), re.I):
            block("the GitHub command is aimed at production.")
        if args and args[0] == "api" and GH_ENVIRONMENTS.search(" ".join(args)):
            block("the GitHub command changes an environment. Do that in the browser.")

    for word, args in calls(command, "supabase"):
        version = os.path.basename(word).partition("@")[2]
        if version and not re.match(r"[~^]?3(?:\.|$)", version):
            block(f"`{os.path.basename(word)}` isn't the pinned Supabase CLI 3, whose commands this hook knows. "
                  "Use `pnpm supabase …`.")
        p = parse_supabase(args)
        if "--reveal" in p.flags or p.words[:2] == ["gen", "keys"]:
            block("the command would print secret keys into the session. Read them in the dashboard instead.")
        remote, target = supabase_target(p)
        if not remote:
            continue
        if not targets:
            block(
                "no production Supabase ref is listed in .claude/hooks/production-targets.txt "
                "yet, so remote Supabase commands stay blocked (fail closed). Add the "
                "production ref first (task T04)."
            )
        if target is not None:
            if UNKNOWN.search(target):
                block("the Supabase target comes from a variable, a command or a pattern, so the hook can't "
                      "tell it isn't production.")
            if any(t in target.lower() for t in targets):
                block("the command targets the production project.")
            if REF_SHAPE.fullmatch(target) or URL_SHAPE.match(target):
                continue  # a literal project or database that isn't production
            if p.target_flag != "--remote":
                block("the Supabase target isn't a project ref or a database URL, so the hook can't check it.")
            # Anything else after `--remote=` is a branch, which belongs to the linked project.
        dirs, unresolved = workdirs(command, p.workdir, payload.get("cwd"))
        if unresolved:
            block("the command changes folder through a variable, so the hook can't tell which project is linked.")
        if linked_refs(payload, dirs) & set(targets):
            block("the linked Supabase project is production. Link staging instead.")


def check_mcp(tool, args, targets):
    text = json.dumps(args).lower()
    hit = next((t for t in targets if t in text), None)
    if hit:
        block(f"the {tool} call names the production target '{hit}'.")
    if not targets and re.search(r"supabase|vercel", tool, re.I):
        block(
            f"{tool} could reach production, and no production identifiers are listed in "
            ".claude/hooks/production-targets.txt yet (fail closed)."
        )


def main():
    try:
        payload = json.load(sys.stdin)
        tool = payload.get("tool_name", "")
        args = payload.get("tool_input") or {}
        targets = load_targets()
        if tool == "Bash":
            check_bash(args.get("command") or "", targets, payload)
        elif tool.startswith("mcp__"):
            check_mcp(tool, args, targets)
    except Exception as error:  # a crash must never let a command through
        block(f"the production hook couldn't check this call ({type(error).__name__}).")
    sys.exit(0)


if __name__ == "__main__":
    main()
