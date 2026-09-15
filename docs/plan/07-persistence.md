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

The foreground process gives a bare name, which loses arguments — and
arguments are frequently the whole point, since `claude --continue` resumes a
conversation where `claude` starts a fresh one. So the driver also reassembles
the line being typed, and when that line's first word matches the foreground
process it keeps the full line. A stray control character clears the buffer,
because whatever is half-typed inside an interactive program is not a command.

On restore the command is **typed into a fresh shell** rather than replacing
it. Replacing the shell would mean the tab vanishes the moment the command
exits, and it would lose quoting that the shell parses for free.

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
