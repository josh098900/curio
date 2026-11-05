#!/usr/bin/env python3
"""PreToolUse hook: stop edits to applied database migrations.

A migration counts as applied once it's merged into main: it exists in main or
origin/main, from where CI applies it. Applied migrations never change; a
schema change goes in a new file made with `pnpm supabase migration new <name>`.
A migration committed only on an unmerged branch has run on nothing but the
local stack, so it can still be edited. Checks the file tools, and Bash
commands that would change, move or delete an applied migration.

Exit code 2 blocks the tool call; the message on stderr goes back to Claude.
"""

import json
import os
import re
import shlex
import subprocess
import sys

REFS = ("main", "origin/main")
MIGRATIONS = "supabase/migrations"
# Commands that leave files alone. sed, awk, find and git are refined in mutates().
READ_ONLY = {
    "cat", "less", "more", "head", "tail", "grep", "egrep", "fgrep", "rg", "wc", "ls", "stat",
    "file", "diff", "cmp", "shasum", "sha256sum", "md5", "md5sum", "bat", "nl", "sort", "uniq",
    "cut", "cd", "pwd", "echo", "printf", "test", "[", "open", "code", "tree", "xxd", "hexdump",
    "realpath", "basename", "dirname", "supabase", "psql", "sed", "awk", "gawk", "find", "git",
}
PREFIXES = {"sudo", "time", "command", "nohup", "env"}
REDIRECTS = {">", ">>", "1>", "1>>", "2>", "2>>", "&>", "&>>", ">|"}


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)


def toplevel(path):
    d = os.path.abspath(path)
    while not os.path.isdir(d):
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    result = git(d, "rev-parse", "--show-toplevel")
    return os.path.realpath(result.stdout.strip()) if result.returncode == 0 else None


def applied_path(path):
    """The repo-relative path if `path` is a migration merged into main, else None."""
    real = os.path.realpath(path)
    root = toplevel(os.path.dirname(real))
    if not root:
        return None
    rel = os.path.relpath(real, root).replace(os.sep, "/")
    if not rel.startswith(MIGRATIONS + "/") or not rel.endswith(".sql"):
        return None  # only .sql files are migrations; a .gitkeep isn't
    if any(git(root, "cat-file", "-e", f"{ref}:{rel}").returncode == 0 for ref in REFS):
        return rel
    return None


def applied_migrations(root):
    names = set()
    for ref in REFS:
        result = git(root, "ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS)
        if result.returncode == 0:
            names.update(line for line in result.stdout.splitlines() if line.endswith(".sql"))
    return names


def segments(command):
    parts = []
    for line in command.splitlines():
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


def mutates(name, args):
    if name not in READ_ONLY:
        return True
    if name == "sed":
        return any(a == "--in-place" or (a.startswith("-") and not a.startswith("--") and "i" in a[1:])
                   for a in args)
    if name in ("awk", "gawk"):
        return "inplace" in args or "-iinplace" in args
    if name == "find":
        return bool({"-delete", "-exec", "-execdir", "-ok", "-okdir"} & set(args))
    if name == "git":
        words = [a for a in args if not a.startswith("-")]
        return bool(words) and words[0] in {"rm", "mv", "apply", "am"}
    return False


def check_bash(command, payload):
    if not re.search(r"migrations|\.sql\b|\bsupabase\b", command):
        return
    cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    root = toplevel(cwd)
    if not root:
        return
    applied = applied_migrations(root)
    if not applied:
        return
    basenames = {os.path.basename(p) for p in applied}
    # The folder the command is in at each point, followed through `cd`; unknown after `cd "$X"`.
    base, unknown_base = os.path.realpath(cwd), False

    def relative(path):
        return os.path.relpath(path, root).replace(os.sep, "/")

    def in_migrations():
        rel = relative(base)
        return rel == MIGRATIONS or rel.startswith(MIGRATIONS + "/")

    def refers(token, destructive):
        norm = token.rstrip("/")
        if relative(os.path.realpath(os.path.join(base, os.path.expanduser(norm)))) in applied:
            return True  # the path itself, resolved from where the command is
        if (in_migrations() or unknown_base) and os.path.basename(norm) in basenames:
            return True  # a bare name inside the folder, or after a `cd` the hook can't follow
        if re.search(r"(^|/)migrations$", norm) or ("migrations/" in norm and re.search(r"[*?\[]", norm)):
            return True
        if in_migrations() and (norm in (".", "") or re.search(r"[*?\[]", norm)):
            return True
        return destructive and re.fullmatch(r"(\./)?supabase|.*/supabase", norm) is not None

    for seg in segments(command):
        i = 0
        while i < len(seg) and (seg[i] in PREFIXES or re.fullmatch(r"\w+=.*", seg[i])):
            i += 1
        if i >= len(seg):
            continue
        name, args = os.path.basename(seg[i]), seg[i + 1 :]
        if name == "cd":
            target = args[0] if args else "~"
            if re.search(r"[$`]", target) or target == "-":
                unknown_base = True
            else:
                base = os.path.realpath(os.path.join(base, os.path.expanduser(target)))
            continue
        for j, arg in enumerate(args):
            target = None
            if arg in REDIRECTS and j + 1 < len(args):
                target = args[j + 1]
            elif re.match(r"^(?:[12&]?>>?|>\|)(?=\S)", arg):
                target = re.sub(r"^(?:[12&]?>>?|>\|)", "", arg)
            if target and refers(target, False):
                deny(target)
        if name in ("xargs", "parallel") and "migrations" in command:
            deny(f"{MIGRATIONS} (through {name})")
        if mutates(name, args):
            destructive = name in {"rm", "mv", "find", "rsync", "git"}
            for arg in args:
                if refers(arg, destructive):
                    deny(arg)


def deny(target):
    print(
        f"Blocked: {target} is an applied migration (it's in main). Applied migrations never "
        "change; write a new one with `pnpm supabase migration new <name>` (see .claude/rules/database.md).",
        file=sys.stderr,
    )
    sys.exit(2)


def main():
    payload = json.load(sys.stdin)
    tool = payload.get("tool_name", "")
    args = payload.get("tool_input") or {}
    if tool in {"Edit", "Write", "MultiEdit", "NotebookEdit"}:
        path = args.get("file_path") or args.get("notebook_path") or ""
        if path and "migrations" in path:
            rel = applied_path(path)
            if rel:
                deny(rel)
    elif tool == "Bash":
        check_bash(args.get("command") or "", payload)
    sys.exit(0)


if __name__ == "__main__":
    main()
