#!/usr/bin/env python3
"""PreToolUse hook: stop Claude reading or editing .env files.

Checks the file tools (Read, Edit, Write, MultiEdit, NotebookEdit), Grep calls
aimed at an env file, and Bash commands that name one. Templates that hold no
values (.env.example, .env.sample, .env.template) stay readable and editable.

Exit code 2 blocks the tool call; the message on stderr goes back to Claude.
"""

import json
import os
import re
import shlex
import sys

TEMPLATES = {".env.example", ".env.sample", ".env.template"}

# .env, .env.local, .env.production.local, and globs such as .env* that expand to them.
DOTENV_NAME = re.compile(r"^\.env(?:[.*?\[].*)?$")
# Files such as prod.env. In Bash this only counts for a path with a /, so code
# like process.env, import.meta.env or Deno.env isn't mistaken for a file.
SUFFIX_NAME = re.compile(r"^[\w.-]+\.env$")
# A .env reference anywhere in a command: in quotes, after = or a redirect, in a path.
# process.env and import.meta.env don't match, because a word character precedes them.
DOTENV_IN_TEXT = re.compile(r"(?<![\w.-])\.env(?:\.[\w.*-]+|\*)?(?![\w-])")
# Commit messages and PR text can mention .env without touching one.
MESSAGE_FLAGS = ("-m", "--message", "--body", "--title")


def is_env_file(path, bare_suffix=True):
    name = os.path.basename(path.rstrip("/"))
    if name in TEMPLATES:
        return False
    suffix = SUFFIX_NAME.match(name) and (bare_suffix or "/" in path)
    return bool(DOTENV_NAME.match(name) or suffix)


def mentions_env_file(text):
    return next((m.group(0) for m in DOTENV_IN_TEXT.finditer(text) if m.group(0) not in TEMPLATES), None)


def drop_messages(tokens):
    kept, skip = [], False
    for token in tokens:
        if skip:
            skip = False
        elif token in MESSAGE_FLAGS:
            skip = True
        elif not token.startswith(tuple(flag + "=" for flag in MESSAGE_FLAGS)):
            kept.append(token)
    return kept


def command_names_env_file(command):
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = None
    text = command
    if tokens is not None and re.search(r"\bgit\b.*\bcommit\b|\bgh\s+(?:pr|issue)\b", command, re.S):
        tokens = drop_messages(tokens)
        text = " ".join(tokens)
    found = mentions_env_file(text)
    if found:
        return found
    for token in tokens if tokens is not None else text.split():
        for part in re.split(r"[=:<>|;&()]", token):
            if part and re.fullmatch(r"[\w./~*?\[\]-]+", part) and is_env_file(part, bare_suffix=False):
                return part
    return None


def block(target):
    print(
        f"Blocked: {target} is a .env file. Claude doesn't read or edit .env files, "
        "because they hold secrets. Document settings without values in .env.example, "
        "and ask the developer if a value is needed.",
        file=sys.stderr,
    )
    sys.exit(2)


def main():
    payload = json.load(sys.stdin)
    tool = payload.get("tool_name", "")
    args = payload.get("tool_input") or {}

    if tool in {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit"}:
        path = args.get("file_path") or args.get("notebook_path") or ""
        if path and is_env_file(path):
            block(path)
    elif tool == "Grep":
        for key in ("path", "glob"):
            value = args.get(key) or ""
            if value and (is_env_file(value) or mentions_env_file(value)):
                block(value)
    elif tool == "Bash":
        found = command_names_env_file(args.get("command") or "")
        if found:
            block(found)
    sys.exit(0)


if __name__ == "__main__":
    main()
