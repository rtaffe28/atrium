#!/bin/bash
# Atrium shim for Claude Code.
self_dir="$(cd "$(dirname "$0")" && pwd)"
clean=""
old_ifs="$IFS"
IFS=:
for entry in $PATH; do
  [ "$entry" = "$self_dir" ] && continue
  clean="${clean:+$clean:}$entry"
done
IFS="$old_ifs"
export PATH="$clean"

real="$(command -v claude 2>/dev/null)"
if [ -z "$real" ]; then
  echo "atrium: claude is not on PATH" >&2
  exit 127
fi

# An explicit choice by the user always wins.
for arg in "$@"; do
  case "$arg" in
    --session-id|--resume|-r|--continue|-c) exec "$real" "$@" ;;
  esac
done

state="${ATRIUM_SESSION_STATE:-}"
if [ -z "$state" ]; then
  exec "$real" "$@"
fi
mkdir -p "$state" 2>/dev/null

if [ -f "$state/resume" ]; then
  id="$(cat "$state/resume" 2>/dev/null)"
  rm -f "$state/resume"
  if [ -n "$id" ]; then
    printf '%s' "$id" > "$state/current"
    exec "$real" --resume "$id" "$@"
  fi
fi

# A fresh conversation, with an id Atrium can restore later.
id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
printf '%s' "$id" > "$state/current"
exec "$real" --session-id "$id" "$@"
