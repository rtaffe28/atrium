# Developing Atrium in Atrium: what it exposes

**Status: two known frictions, neither fixed.** The workflow itself works —
`581a3de` gave a dev run its own `userData`, nothing takes a single-instance
lock, and the recipe is in the root README. What follows is what using it
turned up on the first day. Both are small. Both are the kind of thing that
costs a little every hour rather than failing loudly once, which is why they
want writing down rather than remembering.

## 1. The README describes a different project

The header is the first thing a reader sees, and it is now wrong in three
places:

| It says | Actually |
|---|---|
| "Status: stage 1 of 8" | `04-roadmap.md` ticks through stage 6.5; 7 (worktrees) and 8 (lifecycle) are what remain |
| "This is a UI mock. There are no real processes; a `MockDriver` plays scripted agent output" | Real PTYs, real shells, zsh and bash integration, Claude lifecycle hooks. `MockDriver` is the browser-tab host, not the app |
| "`npm test` # 51 tests" | 125 |

The roadmap is not entirely clean either: stages 3 (a real terminal in a
browser tab) and 4 (resize) carry no ✅ despite 5 and 6 having one, which they
could not have without them. Tick them while you are in there.

This is the ordinary drift of a status line written once and never revisited,
and it matters more than most stale docs because it is load-bearing: it is what
someone reads before deciding whether the project does anything yet. It
currently undersells the thing considerably.

The fix is a rewrite of the header block, not a patch of the numbers — a test
count in prose will go stale again by the end of the week. Say what the app is
and what stage it is at, link `04-roadmap.md` for the detail, and let the
number live in the one place that cannot drift, which is the test run.

## 2. The dev window and the installed window are indistinguishable

Same icon, same title bar, same rail. Once both are open — which is the whole
point of the isolation — nothing on screen or in the task switcher says which
is which. The consequences are asymmetric: mistaking the dev build for the
installed one wastes a moment, and mistaking the installed one for the dev
build means typing into the window holding your real agents.

Nothing about this needs new plumbing. The renderer already knows: the host
reports `platform`, and `app.isPackaged` is what decides the `-dev` `userData`
path in the first place, so the same bit can reach the title bar. What it wants
is the smallest marker that survives a glance — a word or a dot next to the
session name in `TitleBar.tsx`, not a banner.

The icon is the harder half and probably not worth it: the taskbar entry comes
from the `.desktop` file for the installed app, and from whatever Electron
picks for an unpackaged run, so making them differ means a second icon in the
build. A title-bar marker plus the fact that `atrium-dev` opens with an empty
rail is likely enough to tell them apart.

## Why these are here rather than in an issue tracker

Both were found by using the thing, not by reading it, and that is the argument
for the workflow: the friction a tool has is invisible until the tool is what
you are working in. Expect this document to collect more of them, and expect
most entries to be this size.
