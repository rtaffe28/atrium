# Agent state: show what the program says, the way a terminal does

**Status: built.** Atrium does not decide whether an agent is working, waiting
or done. It shows what the program in each tab asks a terminal to show — a
title, a bell, a notification, progress — exactly as Ghostty, iTerm2 and kitty
do, and nothing else. A tab that says nothing shows nothing.

## Why not a state machine of our own

Three approaches to knowing what an agent was doing were built and taken out
(`53c9ec7`):

1. **Inferring it from output.** Bytes arriving meant working; a quiet gap
   meant done. A spinner, a status line or a repainting TUI all read as work,
   and any pause read as finished. The rail flickered at the rate of the
   animation, and the finished chime rang for it.
2. **Claude's lifecycle hooks.** `UserPromptSubmit`, `Stop` and `Notification`
   were accurate, and covered Claude only. Everything else fell back to (1).
3. **Watching every tab from outside**: process tree, CPU time, a headless copy
   of the screen. It generalised across agents and raised too many false
   positives to notify on. The defining case: Claude starts a dev server and
   ends its turn. The server keeps the process tree busy indefinitely; the
   agent is idle.

All three asked Atrium to *classify* a tab, and every classifier is wrong
somewhere. The best terminals never classify. Ghostty has no idea whether
Claude is working; it draws the title Claude sets, raises the notification
Claude sends, and that is the whole feature. It is never wrong, because it
never claims anything the program did not.

## What is shown, and what clears it

| The program sends | Atrium shows | Until |
|---|---|---|
| OSC 0 / 2 — title | the tab's name | another title, or the shell is back (OSC 133 D / A) |
| a spinner frame in that title, or OSC 9;4 progress | **Working** on the session in the rail, a dot on the tab | the spinner leaves the title, `9;4;0`, the shell is back — by its OSC 133 mark, or as the foreground process — or the pty exits |
| BEL — a real one, not an OSC terminator | a mark on the tab and its session; a tone if *Bell sound* is on | you look at the tab |
| OSC 9 / 777 / 99 — a notification | the same mark, and a desktop notification if *Desktop notifications* is on; clicking it opens the tab | you look at the tab |

"Looking at" is the active tab of the focused pane in a focused window. That
tab is never marked or notified for — a terminal does not interrupt you about
the thing in front of you — and the moment you look at a marked tab, the mark
goes. A wrong alert therefore costs one glance.

The window also bounces the dock (macOS) or flashes its taskbar entry (Linux,
Windows) for either kind of request, if it is in the background.

None of this is saved. It described a process that died with the app.

### Working → finished

There is one state machine, and it decides nothing about *whether* a tab is
working — that is `isWorking()`, read from what the program sent. It only
watches that answer change, per tab, and reports the edge from working to not
as `finished` (`SessionStore.trackWorking()`):

- **It settles first.** The finish is held for 1.5 s and dropped if the tab is
  working again by then, so a program dropping its spinner between two steps
  is not a finish.
- **It does not repeat the program.** If the tab's program sent a notification
  or rang in the last 10 s — Codex at the end of every turn, Claude at a
  permission prompt — that already said it.
- **It is quiet for the tab in front of you**, like everything else here.
- **An agent that exits mid-turn has finished too.** The shell coming back
  takes the spinner down, and that is the same edge.

What happens on a finish is the user's choice: *Notify when work finishes*,
on by default, marks the tab and posts "<task> finished". Off, nothing
happens at all. It is the only alert Atrium raises on its own observation
rather than the program's request, which is why it has its own switch.

Claude Code still sends its own "waiting for your input" after 60 s idle, so
with both on a finished Claude turn notifies twice: at once from Atrium, and
a minute later from Claude.

### What the agents actually send

Measured from a raw pty with `TERM_PROGRAM=Atrium`, October 2026:

| | Title | Notification | Progress |
|---|---|---|---|
| Claude Code 2.1.290 | `◐ <task>` spinning while a turn runs, `✳ <task>` when idle | OSC 777 at once for a permission prompt; after 60 s idle for "waiting for your input" | none — see below |
| Codex 0.155.1 | braille spinner while working | OSC 9 when a turn ends, body = its last message; also on approval requests | none |

So *working* is read from the one thing every agent already sends: the
spinner it animates in its title while busy and removes when it stops. Atrium
looks for the common frame sets — braille dots (Codex and most CLIs, through
cli-spinners) and the rotating quarters `◐◑◒◓ ◴◵◶◷ ◰◱◲◳` (Claude) — rather than
for any one agent, so a new agent that spins the usual way is covered without
a change. `isWorking()` in `signals.ts` is the whole rule. An agent that does
not animate its title and does not send OSC 9;4 shows no tag, which is the
honest answer for a program that does not say.

An agent that wants you is a notification it chose to send. The
dev-server case from (3) shows an idle title and nothing else, which is true.

Claude's 60-second idle delay is Claude's: `messageIdleNotifThresholdMs` in
`~/.claude.json`, not something `--settings` can set. A permission prompt is
immediate.

## What the shims turn on

Neither agent sends notifications to a terminal it does not recognise by
`TERM_PROGRAM`, so each is asked to, for that run only:

- **Claude**: `preferredNotifChannel: "ghostty"` in the `--settings` file the
  shim already passes. That is OSC 777, title and body.
- **Codex**: `-c tui.notifications=true -c tui.notification_method="osc9"
  -c tui.notification_condition="always"`. *Always*, because Codex otherwise
  only notifies when it believes it is unfocused, and Atrium already knows
  which tab you are looking at. The user's `config.toml` is not touched.

Ptys get `TERM_PROGRAM=Atrium` and no `TERM_PROGRAM_VERSION`. A dev run started
from Ghostty used to hand its tabs `TERM_PROGRAM=ghostty`, and agents choose
their notification channel and keyboard handling from that.

**Claude's progress bar is not available.** It emits OSC 9;4 only where
`TERM_PROGRAM` is Ghostty ≥ 1.2 or iTerm ≥ 3.6.6, or a ConEmu variable is set;
`terminalProgressBarEnabled` cannot override that. Impersonating either terminal
would change far more of Claude's behaviour than its progress bar, so Atrium
does not. Its spinner title carries the same information. OSC 9;4 still counts
as working, for the tools that send it unconditionally (Pi, dnf5, Windows
tools) and for Claude if its list grows.

## Where it lives

- `src/session/signals.ts` — the scanner: one state machine over each tab's
  raw output, so a sequence split between reads is not lost and a BEL ending
  an OSC string is not a bell. It reads OSC 133 D / A too, so that a title
  set on the way out and the prompt after it are taken in the order written.
- `src/session/store.ts` — `receiveSignals()` puts what was sent on the tab,
  `setFocusedTab()` and `onAlert()`; both drivers feed it every chunk,
  rendered or not, because a background tab is the one you need to hear from.
- `src/alerts.ts` — passes requests to `host.notify`, and a click back to the
  tab. For the program's requests there is no policy about *when*: the program
  decided that. For `finished` it is the setting.
- `src/components/TabBar.tsx`, `Sidebar.tsx` — the working tag and the marks.
- `electron/main.ts` — native notifications that survive garbage collection
  long enough to be clicked, and the dock bounce.
- `electron/shims.ts`, `electron/shell/codex.sh` — the switches above.

`SessionStart` is still the one hook registered with Claude. It is not about
state: it records which conversation a tab is on, which restore needs and
nothing outside the agent can observe.
