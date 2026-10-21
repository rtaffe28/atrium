#!/bin/bash
# Atrium's command for the programs in its tabs.
#
# A request is a small file written into the tab's own state directory —
# ATRIUM_SESSION_STATE, exported into the tab's shell before anything starts —
# where the app reads it, checks it, and acts or declines. The first line is
# the verb and the rest is the argument, with no JSON and so no escaping to
# get wrong. Nothing comes back: the exit code says the request was written,
# not what happened to it.
usage() {
  cat <<'USAGE'
atrium — ask the Atrium window this terminal is in to show something

  atrium open <path | url>     show a file or folder in a tab beside this one,
                               or an http(s) URL in a browser tab
  atrium report <key> <value>  say something about this session, for the rail
                               to show — e.g. report summary "migrating auth"

A path may end in :line. Requests are one-way: a request for something that
is not there opens nothing, and the tab's state directory keeps a log line.
Outside an Atrium tab there is nothing to talk to.
USAGE
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  "") usage >&2; exit 2 ;;
esac

state="${ATRIUM_SESSION_STATE:-}"
if [ -z "$state" ]; then
  echo "atrium: not inside an Atrium tab (ATRIUM_SESSION_STATE is not set)" >&2
  exit 1
fi

verb="$1"
shift
case "$verb" in
  open)
    if [ $# -ne 1 ]; then
      echo "atrium: open takes one path or URL" >&2
      exit 2
    fi
    arg="$1"
    case "$arg" in
      *://*) ;;            # a URL, as given
      /*) ;;               # absolute already
      '~'|'~/'*) ;;        # the app expands ~
      *) arg="$PWD/$arg" ;; # relative to where the command ran
    esac
    ;;
  report)
    if [ $# -ne 2 ]; then
      echo "atrium: report takes a key and a value" >&2
      exit 2
    fi
    arg="$1
$2"
    ;;
  *)
    echo "atrium: unknown command '$verb'" >&2
    usage >&2
    exit 2
    ;;
esac

dir="$state/requests"
if ! mkdir -p "$dir" 2>/dev/null; then
  echo "atrium: cannot write to $dir" >&2
  exit 1
fi

# One file per request, named so they are read in the order they were made.
# Written under a dot name and renamed, so the app never reads half of one.
name="$(date +%s)-$$-$RANDOM"
printf '%s\n%s\n' "$verb" "$arg" > "$dir/.$name" && mv "$dir/.$name" "$dir/$name"
