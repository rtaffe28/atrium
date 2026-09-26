# Agent state: what a tab knows, and how well

**Status: removed, pending a redesign.** The rail, the tab bar and
notifications no longer show whether a session is working, waiting or done.
Three approaches were tried, and none was good enough to interrupt someone
with:

1. **Inferring it from output** (below): bytes arriving meant working, and a
   quiet gap meant done. A spinner, a status line or a TUI repainting all read
   as work, and any pause read as finished.
2. **Claude's lifecycle hooks** (below): accurate, but only for Claude. Codex
   and everything else fell back to the inference.
3. **Watching every tab from outside:** its process tree, CPU time and a
   headless copy of its screen, classified with a debounce and scoped to a
   user-editable list of programs. It generalised across harnesses, but in
   real use it raised too many false positives to notify on.

What stays is the one hook that answers a different question. `SessionStart`
still records which conversation a tab is on, because restore depends on it
and nothing outside the agent can observe it. The rest of this document is
the record of approaches 1 and 2, for whoever does the redesign.

## Where each state comes from

| State | Source | How good |
|---|---|---|
| any | Claude lifecycle hook | A report, from the process that knows. Supersedes everything below for that tab. |
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

## What fixes it: asking the agent

It is the same move that shell integration made for command lines. A tab once
recorded `2.1.273` as its command, from the foreground process name, because a
process that renames itself will lie to anyone who infers rather than asks.
Asking ended that class of bug. Asking ends this one.

The shim hands `claude` a `--settings` file registering five hooks, each
pointing at `electron/shell/hook.sh`:

| Hook | Writes | Means |
|---|---|---|
| `SessionStart` | `current` | this is the conversation, however it began |
| `UserPromptSubmit` | `status` = `working` | a turn has started |
| `Stop` | `status` = `done` | the turn is over |
| `Notification` | `status` = `waiting` | the agent is asking for something |
| `SessionEnd` | removes `status` | there is no agent here any more |

Every hook runs inside the agent's own process tree, so `ATRIUM_SESSION_STATE`
— exported into the tab's shell before anything starts — already says which tab
it is. No pid resolution, no directory matching, nothing to get wrong. The
files land in the directory the renderer already polls every two seconds, so
there is no socket and no daemon.

`--settings` adds a layer rather than replacing one, so the user's own hooks
still run; Claude concatenates the arrays. If the user passes their own
`--settings` the shim stands aside entirely, because ours would replace theirs
and a flag that silently stops working is worse than a tab that reports
nothing.

### What this also fixed

`SessionStart` fires for a conversation **however it began** — new, `--resume`,
`--continue`, the picker, or `/resume` inside a session already running. That
last set is precisely what a wrapper around the command line cannot see, and
not seeing it was a real bug: resuming a conversation by hand left the tab
still bound to the one before it, and restore reopened the wrong one.

The workaround for that — scanning `~/.claude/projects/<cwd>/` for the
transcript being appended to — is **deleted**. It was inference, it could bind
the wrong conversation when two tabs shared a directory, and the hook answers
the same question exactly. Two answers to one question is how the rail came to
flicker in the first place.

### What cmux does

The same thing, with a bigger machine around it. Its wrapper
(`Resources/bin/cmux-claude-wrapper`, ~1,800 lines of bash) registers
`SessionStart`, `Stop`, `SessionEnd`, `Notification`, `UserPromptSubmit`,
`SubagentStop` and `PreToolUse` against its own Swift CLI, which talks to the
app over a unix socket. It resolves *which pane* a hook came from by exporting
`CMUX_CLAUDE_PID=$$` before `exec`, then mapping pid → controlling tty → pane;
our per-tab state directory makes that step unnecessary. It also repoints
`CLAUDE_CONFIG_DIR` on an explicit resume so a foreign config dir cannot turn a
valid resume into "No conversation found" — worth remembering if Atrium ever
sets that variable, which it does not.

cmux is proprietary, so this was read for the idea and written fresh. The hook
protocol itself is Claude Code's public interface and owes it nothing.

## What is still inferred

Codex, and anything else run by hand. Codex has no hook mechanism of this kind,
so a codex tab still gets the output-timing guess and the flicker that comes
with it. The question there is whether to keep inferring or to report nothing
between the bell and the exit — which is the trade the section above used to
frame, and is now a question about one agent rather than all of them.

The inference is not dead code for another reason: a tab only stops guessing
once its agent has actually reported. A Claude tab that has not said anything
yet, or one running through a shell Atrium could not hook, still falls back.

## Where it lives

- `electron/shell/hook.sh` — the hook itself; `electron/shims.ts` generates the
  settings that register it, and `electron/shell/claude.sh` passes them on.
- `electron/main.ts` — `agent:report`, one read of what a tab's agent has said.
- `src/host/electron/session.ts` — `applyReport()` takes the agent at its word
  and adds the tab to `reporting`, which is what `receive()` checks before
  inferring anything; `receive()` holds the inference and its two exemptions;
  `applyShellEvents()` handles the reported exit and tells `receive()` that it
  did.
- `src/session/bell.ts` — a real bell against an OSC terminator.
- `src/session/shellEvents.ts` — the OSC 633/133 scanner.
- `src/notifications.ts` — the policy for which transitions interrupt a human.
- `src/session/mock.ts` — `MockDriver` plays scripted states, which is fine:
  a mock is a design surface, not a measurement.
