# Developing Atrium in Atrium: what it exposes

**Status: four frictions found so far, all now fixed.** The workflow itself
works — `581a3de` gave a dev run its own `userData`, nothing takes a
single-instance lock, and the recipe is in the root README. What follows is
what using it turned up, and what closing each one took. All were small. All
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

## 3. A screenshot could not be pasted into Claude — fixed

Cmd+V with a screenshot on the clipboard did nothing: no image in the prompt,
no error, nothing in the terminal. Text pasted fine. The same screenshot goes
into Claude Code in Terminal.app or iTerm2 with Ctrl+V, which is the key
Claude Code documents for images on macOS — a terminal's Cmd+V pastes text,
and an image has none.

Two things were true at once. xterm.js handles a paste by reading the
clipboard's `text/plain` and writing it to the pty, and an image on its own
has no text, so the paste was dropped before it reached anything. And Ctrl+V
worked in Atrium all along — xterm sends `0x16` for it and nothing in the app
takes it — but nothing said so, and Cmd+V is what a Mac app's Edit menu
offers.

**What was done.** `encodePaste()` in `src/keyboard/terminal.ts`, beside the
Shift+Enter re-encoding: a paste with an image and no text becomes `0x16`,
the byte Ctrl+V sends, which is Claude Code's cue to read the clipboard image
itself and attach it. A paste with any text in it is still xterm's to make,
image or not — the text is what was asked for. The handler is a capturing
listener on the terminal's host element, so it is decided before xterm's own
paste handling sees the event. In a shell the byte is quoted-insert, which
waits for a key and is harmless; the image was going nowhere there either.

Not done: writing the image to a file and pasting its path, which would work
for any program that takes a path. Claude Code's own clipboard read gives it
the image as an attachment rather than a path to go and open, and costs one
byte rather than a temp file to manage.

## 4. Two Claudes in one session fought over its name — fixed

With two agents side by side in a split, the session's name on the rail
flickered between the two conversations' names. Each Claude writes its own
name into its title with a spinner in front of it, and every frame of either
spinner reached `nameSession()`, which took whichever title had just been
written. Two agents meant two names, swapped several times a second.

**What was done.** One session follows one program. The session records which
tab named it — `namedBy`, saved with the session so a restart does not reopen
the question — and that program keeps the name for as long as it has a title.
Another program's name takes over once it has exited, which clears its title
as the shell comes back, or its tab has left the session. The flicker was the
symptom; the rule it exposed is the fix: a session named after an agent does
not change its name because a second agent started working beside it.

## Why these are here rather than in an issue tracker

Both were found by using the thing, not by reading it, and that is the argument
for the workflow: the friction a tool has is invisible until the tool is what
you are working in. Expect this document to collect more of them, and expect
most entries to be this size.
