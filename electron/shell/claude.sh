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

state="${ATRIUM_SESSION_STATE:-}"
[ -n "$state" ] && mkdir -p "$state" 2>/dev/null

# An explicit choice by the user always wins. Write down which conversation it
# was where that is knowable: a resumed id is as much this tab's conversation
# as one we handed out, and a tab that does not know cannot restore.
#
# `claude --resume` with no id opens a picker, and `--continue` names nothing
# at all; neither can be recorded here. Atrium reads those back from Claude's
# own transcripts instead — see agent:newest-claude-session.
prev=""
for arg in "$@"; do
  case "$prev,$arg" in
    --resume,*|-r,*)
      case "$arg" in
        -*) ;;
        *) [ -n "$state" ] && printf '%s' "$arg" > "$state/current" ;;
      esac
      ;;
  esac
  case "$arg" in
    --resume=*) [ -n "$state" ] && printf '%s' "${arg#--resume=}" > "$state/current" ;;
  esac
  prev="$arg"
done

for arg in "$@"; do
  case "$arg" in
    --session-id|--resume|-r|--continue|-c) exec "$real" "$@" ;;
    --session-id=*|--resume=*) exec "$real" "$@" ;;
  esac
done

if [ -z "$state" ]; then
  exec "$real" "$@"
fi

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
