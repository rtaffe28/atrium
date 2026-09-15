# Persistence — and what it cannot do

The workspace is saved continuously and restored on launch: sessions, panes,
the split tree, tab order, cwd, branch, and each terminal's scrollback.

- **Electron** writes `workspace.json` in the app's userData directory, via
  write-then-rename so a crash mid-write leaves the previous good file intact
  rather than a truncated one that loses every session.
- **Browser** writes to localStorage with a much smaller scrollback budget
  (32 KB per tab against 256 KB on disk), because filling the origin's quota
  would lose the whole workspace to buy a longer history.

Saving is debounced by 700 ms. A splitter drag fires a change per frame, and
writing the workspace sixty times a second would be absurd.

## Commands come back, because we record what was running

Restoring the layout is not enough. If you opened a plain shell and typed
`claude` into it, nothing about the tab says so — and a restart hands you back
a bare prompt and a hunt for the session you had.

So each tab records **what is actually running in it**, taken from the pty's
foreground process. That is the same signal a terminal uses to title its tabs,
and it is the truth rather than a guess: it knows `vim` is open, not merely
that `vim` was once typed.

The foreground process answers *whether* something is running. It is a poor
answer to *what*, because a process can rename itself — Claude Code reports as
its own version number, so trusting the name recorded `2.1.273` as the command
and restore typed that into a shell.

So the line the user actually submitted wins, and the process name is only a
fallback for a tab nobody typed in. That is better for wrappers too: `npm run
dev` is a more useful thing to restore than `node`. A stray control character
clears the typed buffer, because whatever is half-typed inside an interactive
program is not a command — and anything that could not be typed at a prompt is
rejected outright, on save and again on load, since a workspace written by an
earlier build can hold one.

On restore the command is **typed into a fresh shell** rather than replacing
it. Replacing the shell would mean the tab vanishes the moment the command
exits, and it would lose quoting that the shell parses for free.

It is typed once the shell has been **quiet for 350 ms**, not on its first
byte. The first chunk is usually a partial line or terminal setup rather than a
prompt, and characters sent then are mangled by a line editor that is not ready
yet.

## Overrides, because only the agent knows how to resume itself

A restored `claude` that opens a blank conversation is a restored tab with no
value. So captured commands are rewritten on the way back in, from a mapping in
Settings → Restoring a session:

```
claude = claude --continue
```

This is a mapping rather than something the app is clever about, because the
resume flag is the agent's business and guessing it for tools we have never
seen would be worse than asking.

**A limitation to know:** `--continue` resumes the most recent conversation *in
that directory*. Two claude tabs in the same directory will both resume the
same one. Targeting a specific conversation needs its session id, which means
capturing something the agent does not currently tell us.

## Replayed scrollback is not inert

Restoring a pane means replaying recorded output into a fresh terminal, and
that output contains escape sequences, not just text. Replayed raw, two things
go wrong:

- **Queries get answered again.** A Device Attributes query makes the terminal
  reply *as input*; at a shell prompt that reply is echoed as literal
  `^[[?1;2c`.
- **Modes get re-armed.** `ESC[?1004h` turns focus reporting back on, so the
  terminal starts sending `^[[O` to a shell that never asked for it.

`session/history.ts` strips mode changes, device-attribute queries, status
reports and OSC colour queries from history before replay, keeping colour,
cursor movement and text. Live output is never filtered — a running program is
entitled to set whatever modes it likes.

## The limitation that remains

**Processes are respawned, not resumed.**

A pseudo-terminal is a child of the app. Quitting ends it — that is not a
choice we make, it is what a child process is.

So after a restart:

- layout, panes and tab order are exactly as you left them ✅
- each terminal shows its previous output, then re-runs its command ✅
- the *process* is new. Whether that costs you anything now depends on the
  command: `claude --continue` picks the conversation back up, plain `claude`
  does not ⚠️

Restored tabs have their agent state cleared rather than inherited. Showing
"working" for a process that no longer exists would be a lie, and it is the
kind of lie that costs someone twenty minutes.

**Keeping the process itself alive** needs the detached daemon from open
question O1 in `03-architecture.md` — a long-lived process that owns the PTYs,
which the GUI attaches to and detaches from. That is the real fix, it is what
tmux does, and it is the reason O1 was worth writing down before any of this
existed.

The seam is already right for it: `attach()` replays history then streams, and
the renderer already tolerates a buffer it did not produce. A daemon changes
where the bytes come from, not the interface.
