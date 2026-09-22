# Developing Atrium in Atrium: what it exposes

**Status: two frictions found on the first day, both now fixed.** The workflow
itself works — `581a3de` gave a dev run its own `userData`, nothing takes a
single-instance lock, and the recipe is in the root README. What follows is
what using it turned up, and what closing each one took. Both were small. Both
were the kind of thing that costs a little every hour rather than failing
loudly once, which is why they wanted writing down rather than remembering.

## 1. The README describes a different project — fixed

The header is the first thing a reader sees, and it was wrong in three places:

| It said | Actually |
|---|---|
| "Status: stage 1 of 8" | `04-roadmap.md` ticks through stage 6.5; 7 (worktrees) and 8 (lifecycle) are what remain |
| "This is a UI mock. There are no real processes; a `MockDriver` plays scripted agent output" | Real PTYs, real shells, zsh and bash integration, Claude lifecycle hooks. `MockDriver` is the browser-tab host, not the app |
| "`npm test` # 51 tests" | 125 at the time of writing, and climbing |

The roadmap was not entirely clean either: stages 3 (a real terminal in a
browser tab) and 4 (resize) carried no ✅ despite 5 and 6 having one, which
they could not have without them.

This is the ordinary drift of a status line written once and never revisited,
and it mattered more than most stale docs because it is load-bearing: it is
what someone reads before deciding whether the project does anything yet. It
undersold the thing considerably.

**What was done.** The header block is a rewrite rather than a patch of the
numbers — a test count in prose goes stale again by the end of the week, so the
comment beside `npm test` now points at the run instead of naming a figure. The
status says what the app is and which stages remain, and links `04-roadmap.md`
for the detail. Stages 3 and 4 are ticked, each with a line on where the work
actually happened: stage 3's scratch WebSocket server was overtaken by Electron
IPC, and stage 4 landed with stage 5.

## 2. The dev window and the installed window are indistinguishable — fixed

Same icon, same title bar, same rail. Once both were open — which is the whole
point of the isolation — nothing on screen or in the task switcher said which
was which. The consequences are asymmetric: mistaking the dev build for the
installed one wastes a moment, and mistaking the installed one for the dev
build means typing into the window holding your real agents.

**What was done.** No new plumbing, as expected. `app.isPackaged` is what
decides the `-dev` `userData` path in the first place, so the same bit now
rides along in `host:info` as `build: 'dev' | 'release'`, reaches the renderer
through the `WindowDriver` seam beside `platform()` and `chromeInsets()`, and
the title bar renders a small yellow `dev` next to the wordmark when it is set.
An unmarked title bar is the installed app.

Two choices worth recording. The marker sits beside the wordmark rather than
the session crumbs because it is a property of the window, not of the session,
and because a fresh dev run has no session for it to sit beside — an empty
`atrium-dev` rail is exactly when you most want to know which window you are
looking at. And `MockHost` answers from `import.meta.env.DEV`: a browser tab
only exists because someone ran `npm run dev`, and there is no installed
browser build for it to be confused with.

The icon is the harder half and is still not done — the taskbar entry comes
from the `.desktop` file for the installed app, and from whatever Electron
picks for an unpackaged run, so making them differ means a second icon in the
build. The title-bar marker plus the empty `atrium-dev` rail is enough to tell
them apart in practice; revisit the icon only if that turns out to be wrong.

## Why these are here rather than in an issue tracker

Both were found by using the thing, not by reading it, and that is the argument
for the workflow: the friction a tool has is invisible until the tool is what
you are working in. Expect this document to collect more of them, and expect
most entries to be this size.
