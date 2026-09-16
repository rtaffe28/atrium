#!/bin/bash
# Atrium shim for Codex. Codex cannot be told an id, only asked to resume one
# it already made, so a fresh run is left completely alone and Atrium observes
# the thread afterwards from the rollout file codex writes.
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

real="$(command -v codex 2>/dev/null)"
if [ -z "$real" ]; then
  echo "atrium: codex is not on PATH" >&2
  exit 127
fi

# A subcommand means the user is driving.
case "${1:-}" in
  ""|-*) ;;
  *) exec "$real" "$@" ;;
esac

state="${ATRIUM_SESSION_STATE:-}"
if [ -n "$state" ] && [ -f "$state/resume-codex" ]; then
  id="$(cat "$state/resume-codex" 2>/dev/null)"
  rm -f "$state/resume-codex"
  if [ -n "$id" ]; then
    exec "$real" resume "$id" "$@"
  fi
fi
exec "$real" "$@"
