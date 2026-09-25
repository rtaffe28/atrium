#!/bin/sh
# Atrium's Claude Code SessionStart hook: records which conversation this tab
# is on.
#
# Every hook runs in the agent's own process tree, so ATRIUM_SESSION_STATE —
# exported into the tab's shell before anything starts — says which tab this
# is without anyone having to work it out from a pid or a directory.
#
# Claude reads this script's stdout as the hook's decision, and blocks on it.
# It prints an empty object and exits 0 whatever happens: a hook that fails is
# a tab that reports nothing, never an agent that will not start.
state="${ATRIUM_SESSION_STATE:-}"
payload="$(cat)"

if [ -n "$state" ]; then
  mkdir -p "$state" 2>/dev/null

  # The payload is JSON, and there is no JSON parser we can count on being
  # installed. Only one flat string field is needed, and it cannot contain a
  # quote — Claude's session ids are uuids.
  id="$(printf '%s' "$payload" | tr -d '\n' \
    | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

  # This is the one report that cannot be got any other way. It fires for a
  # conversation however it began — new, --resume, --continue, the picker, or
  # /resume inside a session that was already running — which is exactly the
  # set of cases a wrapper around the command line cannot see.
  [ -n "$id" ] && printf '%s' "$id" > "$state/current"
fi

printf '{}\n'
exit 0
