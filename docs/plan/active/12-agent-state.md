# Agent state: what a tab knows, and how well

**Status: on, and only partly trustworthy.** Two of the four states are
reported by something that knows. The other two are inferred from output
timing, which is weaker than it looks and is the last significant guess left in
the app.

## Where each state comes from

| State | Source | How good |
|---|---|---|
| `waiting` | BEL in the stream | A fact. Ringing is deliberate — a program that rings is asking for a human. |
| `done` / `error` | OSC `133;D;n` | A fact. The shell announcing that the command exited, with its status. |
| `working` | bytes are arriving | A guess. |
| `done` | no bytes for 1.5s | A guess, and the same guess. |

`session/bell.ts` separates a real bell from the BEL that merely terminates an
OSC sequence, which is why the first row is trustworthy rather than merely
plausible — treating every BEL as a bell made the rail flicker at exactly the
rate an agent rewrote its window title.

## What is wrong with the inferred half

**Output is a poor proxy for progress.** A terminal is not quiet while a
program thinks. It is full of motion that says nothing about whether work is
happening: a spinner, an elapsed-time counter, a progress bar, a status line
redrawing, a TUI repainting on a resize. Every frame of a spinner is a chunk of
output, so a thinking agent reads as *working*; every gap longer than the
timeout reads as *done*. The rail oscillates at whatever rate the animation
runs at, and the finished chime rings for it.

**Two narrower cases have been fixed, and they are worth recording because they
are the same defect wearing different clothes.**

*The echo.* A pty echoes what is written to it, so typing into a tab produced
output, which read as the agent working; stopping typing read as it finishing.
Fixed by ignoring output that arrives within `ECHO_MS` of a keystroke that was
not a submission — and that fix is sound, because it is not a guess about what
the output means. We sent those bytes, so we know. Only the round-trip time is
estimated, and a continuing typist keeps pushing the window ahead of
themselves. Submitting a line (`\r`) is treated differently: a half-typed
answer is still no answer, so a tab goes on saying "needs you" until the line
is actually sent.

*The report being overwritten by the guess.* A chunk carrying `OSC 133;D;1` is
also, unavoidably, output. The inference ran on the same chunk and replaced the
reported `error` with `working`, which settled to `done` 1.5 seconds later — so
a failed command reported itself correctly and was then announced as a success.
A chunk that carried a report no longer feeds the inference.

**Neither of those fixes the spinner, and no version of this will.** The
problem is not which bytes are excluded. It is that the presence of output does
not carry the information being asked of it, so any answer derived from it is a
coincidence that holds until it does not.

## What would fix it properly

**Agent hooks.** [`09-borrowed-ideas.md`](09-borrowed-ideas.md) already names
this the highest-value item on the list, and this is the argument for it. cmux
injects `--settings` into the agent so Claude Code's hooks fire back into the
app with real status. That is a report, from the only process that knows: the
agent says it started working, the agent says it is done, and no amount of
screen redrawing changes either.

It is the same move that shell integration made for command lines. A tab once
recorded `2.1.273` as its command, from the foreground process name, because a
process that renames itself will lie to anyone who infers rather than asks.
Asking ended that class of bug. Asking would end this one.

## If it has to be switched off first

Removing the inferred half is a small change and leaves a coherent app: a tab
reports `waiting` when the agent rings and `done`/`error` when the command
exits, and says nothing in between. It was disabled once, briefly, before being
restored so the echo fix could actually be tried on a working build.

The cost of switching it off is real — no "finished" notification for an agent
that completes a turn without exiting, which for a long-lived agent CLI is
every turn. Whether that is worse than a status that is sometimes confidently
wrong depends on how often the flicker is actually seen, which is the thing to
measure before deciding.

## Where it lives

- `src/host/electron/session.ts` — `receive()` holds the inference and its two
  exemptions; `applyShellEvents()` handles the reported exit and tells
  `receive()` that it did.
- `src/session/bell.ts` — a real bell against an OSC terminator.
- `src/session/shellEvents.ts` — the OSC 633/133 scanner.
- `src/notifications.ts` — the policy for which transitions interrupt a human.
- `src/session/mock.ts` — `MockDriver` plays scripted states, which is fine:
  a mock is a design surface, not a measurement.
