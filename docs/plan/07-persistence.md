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

## The honest limitation

**Processes are respawned, not resumed.**

A pseudo-terminal is a child of the app. Quitting ends it — that is not a
choice we make, it is what a child process is. What comes back is the *shape*
of the workspace plus the scrollback, and then each tab's command runs again.

So after a restart:

- the layout, panes and tab order are exactly as you left them ✅
- each terminal shows its previous output, then a fresh prompt ✅
- the agent that was halfway through a task is **gone**, and a new one starts ❌

Restored tabs therefore have their agent state cleared rather than inherited.
Showing "working" for a process that no longer exists would be a lie, and it is
the kind of lie that costs someone twenty minutes.

## What would fix it

Two different things, worth separating:

**Resuming the conversation** is the agent's job, not ours. `claude --continue`
restores its own context. Making the default command configurable (Settings →
New sessions) is most of what is needed; wiring a per-session "resume" variant
is a small follow-up.

**Keeping the process alive** needs the detached daemon from open question O1
in `03-architecture.md` — a long-lived process that owns the PTYs, which the
GUI attaches to and detaches from. That is the real fix, it is what tmux does,
and it is the reason O1 was worth writing down before any of this existed.

The seam is already right for it: `attach()` replays history then streams, and
the renderer already tolerates a buffer it did not produce. A daemon changes
where the bytes come from, not the interface.
