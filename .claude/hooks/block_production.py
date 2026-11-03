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
  deployment approvals or environment changes through `gh api`;
- environment variables named PROD or PRODUCTION, which hide connection strings;
- Stripe live mode (Curio uses the Stripe sandbox only).

Commands are read the way a shell reads them, as far as a hook can: line
continuations, `;`, `&&` and pipes, shell keywords, launchers such as `pnpm exec`,
and the strings given to `bash -c` or `eval`. A script file can't be seen into, so
a remote command never goes in one (.claude/rules/database.md).

Exit code 2 blocks the tool call; the message on stderr goes back to Claude.
"""

import json
import os
import re
import shlex
import sys
from urllib.parse import urlparse

TARGETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "production-targets.txt")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}
# Words that can come before a CLI name, as in `npx supabase`, `pnpm exec vercel` or `do supabase`.
LAUNCHERS = {"npx", "pnpx", "bunx", "pnpm", "yarn", "npm", "exec", "dlx", "sudo", "env", "time", "command",
             "nohup", "nice", "xargs", "if", "then", "elif", "else", "do", "while", "until", "!", "{"}
# Shells whose `-c` string is a command in its own right; `eval`'s arguments are too.
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
# Commands that never run their arguments, so a CLI name after them is just a word.
READ_ONLY = {"echo", "printf", "grep", "egrep", "fgrep", "rg", "ugrep", "ls", "cat", "head", "tail", "less",
             "more", "wc", "git", "which", "type", "man", "file", "stat", "tree", "jq", "cd", "pwd"}

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
GH_SENSITIVE = {"workflow", "run", "secret", "variable", "api", "environment", "deployment"}
GH_APPROVALS = re.compile(r"pending_deployments|deployment_protection_rule|/environments\b")
# A shell redirection such as `>`, `2>` or `2>/dev/null`. A bare operator takes the next word.
REDIRECT = re.compile(r"\d*(?:>>?|<<?|&>)")
# A word the shell would expand, so the hook can't know its value.
UNRESOLVED = re.compile(r"[$`]")


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


def segments(command):
    """Split a shell command into simple commands at ; && || | & ( ) and newlines."""
    parts = []
    for line in command.replace("\\\n", "").splitlines():
        lexer = shlex.shlex(line, posix=True, punctuation_chars=";&|()")
        lexer.whitespace_split = True
        lexer.commenters = ""
        current = []
        try:
            for token in lexer:
                if token and set(token) <= set(";&|()"):
                    if current:
                        parts.append(current)
                    current = []
                else:
                    current.append(token)
        except ValueError:
            current = line.split()
        if current:
            parts.append(current)
    return parts


def cli_name(token):
    """The program a word names, as in `node_modules/.bin/supabase` or `supabase@3`. macOS ignores case."""
    return os.path.basename(token).split("@")[0].lower()


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
        elif os.path.basename(token).lower() in LAUNCHERS or re.fullmatch(r"\w+=.*", token) or after_flag:
            after_flag = False
        else:
            return None
    return None


def loose(seg, name):
    """(word, arguments) when `name` appears later with a command after it, as in `dotenvx run -- supabase db`.

    A command that only prints or searches words, such as `echo` or `grep`, never counts. For the
    Supabase CLI the next word must be one of its commands or a flag, so `npm view supabase versions`
    isn't mistaken for a call.
    """
    if not seg or os.path.basename(seg[0]).lower() in READ_ONLY:
        return None
    for i in range(1, len(seg) - 1):
        following = seg[i + 1]
        if cli_name(seg[i]) == name and (
                name != "supabase" or following.startswith("-") or following in SUPABASE_COMMANDS):
            return seg[i], without_redirects(seg[i + 1 :])
    return None


def calls(command, name):
    """Yield (word, arguments) for each call to the CLI `name` in a shell command, nested ones included."""
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
    """Split `supabase <args>` into its flags, words, explicit target and --workdir."""
    flags, words, explicit, workdir, i = set(), [], None, None, 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("-"):
            name, _, value = arg.partition("=")
            flags.add(name)
            if name == "--remote":
                # CLI 3: bare `--remote` is the linked project; a target needs `--remote=<ref|branch|url>`.
                explicit = value or explicit
            elif name in SUPABASE_TARGET_FLAGS | SUPABASE_VALUE_FLAGS:
                if not value and i + 1 < len(args):
                    i += 1
                    value = args[i]
                if name in SUPABASE_TARGET_FLAGS:
                    explicit = value
                elif name == "--workdir":
                    workdir = value
        else:
            words.append(arg)
        i += 1
    return flags, words, explicit, workdir


def supabase_target(flags, words, explicit):
    """Return (acts_on_a_remote_project, explicit_target) for a parsed Supabase command."""
    if flags & HELP and flags <= HELP:
        return False, None  # help on its own; after `--` or as a flag's value it's just a word
    if explicit is not None:
        if flags & {"--db-url", "--remote"} and is_local_url(explicit):
            return False, None
        return True, explicit
    if flags & {"--linked", "--remote"}:
        return True, None
    if "--local" in flags or not words:
        return False, None
    command, sub = words[0], (words[1] if len(words) > 1 else "")
    if command in SUPABASE_LOCAL or sub in SUPABASE_LOCAL_SUB.get(command, set()):
        return False, None
    return True, None


def is_local_url(value):
    """True only for a URL with one local host, so `host1,host2` or `?host=` can't slip a remote one in."""
    url = urlparse(value)
    if "," in url.netloc or "host=" in url.query.lower():
        return False
    return (url.hostname or "") in LOCAL_HOSTS


def workdirs(command, workdir, cwd):
    """Folders the CLI might read its link from (--workdir, SUPABASE_WORKDIR and `cd` targets), and
    whether any of them comes from a variable the hook can't resolve."""
    found = [workdir] if workdir else []
    pending = [command]
    while pending:
        for seg in segments(pending.pop()):
            pending += nested(seg)
            if seg[0] == "cd" and len(seg) > 1:
                found.append(seg[1])
            found += [t.partition("=")[2] for t in seg if t.startswith("SUPABASE_WORKDIR=")]
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

    if re.search(r"\b(?:sk|rk)_live_", command):
        block("the command contains a live Stripe key. Curio uses the Stripe sandbox only.")
    for args in invocations(command, "stripe"):
        if any(a.split("=")[0] == "--live" for a in args):
            block("the Stripe CLI is in live mode. Curio uses the Stripe sandbox only.")

    for args in invocations(command, "vercel"):
        words = [a.lower() for a in args if not a.startswith("-")]
        if any(a.split("=")[0] in ("--prod", "--production") for a in args) \
                or (words and words[0] in ("promote", "rollback", "alias", "remove", "rm")) \
                or words[:2] in (["project", "rm"], ["project", "remove"]) \
                or "production" in words or any(a.lower().endswith("=production") for a in args):
            block("the Vercel command targets production, or removes deployments or projects.")

    for args in invocations(command, "gh"):
        if args and args[0] in GH_SENSITIVE and re.search(r"prod", " ".join(args), re.I):
            block("the GitHub command is aimed at production.")
        if args and args[0] == "api" and GH_APPROVALS.search(" ".join(args)):
            block("the GitHub command approves a deployment or changes an environment. Do that in the browser.")

    for word, args in calls(command, "supabase"):
        version = os.path.basename(word).partition("@")[2]
        if version and not re.match(r"[~^]?3(?:\.|$)", version):
            block(f"`{os.path.basename(word)}` isn't the pinned Supabase CLI 3, whose commands this hook knows. "
                  "Use `pnpm supabase …`.")
        flags, words, explicit, workdir = parse_supabase(args)
        if "--reveal" in flags or words[:2] == ["gen", "keys"]:
            block("the command would print secret keys into the session. Read them in the dashboard instead.")
        remote, explicit = supabase_target(flags, words, explicit)
        if not remote:
            continue
        if not targets:
            block(
                "no production Supabase ref is listed in .claude/hooks/production-targets.txt "
                "yet, so remote Supabase commands stay blocked (fail closed). Add the "
                "production ref first (task T04)."
            )
        if explicit is not None:
            if UNRESOLVED.search(explicit):
                block("the Supabase target comes from a variable or a command, so the hook can't tell it isn't production.")
            continue  # a literal target was checked against the production list above
        dirs, unresolved = workdirs(command, workdir, payload.get("cwd"))
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
    payload = json.load(sys.stdin)
    tool = payload.get("tool_name", "")
    args = payload.get("tool_input") or {}
    targets = load_targets()
    if tool == "Bash":
        check_bash(args.get("command") or "", targets, payload)
    elif tool.startswith("mcp__"):
        check_mcp(tool, args, targets)
    sys.exit(0)


if __name__ == "__main__":
    main()
