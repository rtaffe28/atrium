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

## Decide the session id, do not discover it

A restored agent is only worth anything if it comes back as *the same*
conversation. The first attempt used `--continue`, which resumes whichever
conversation ran most recently in that directory — already wrong with two tabs
open on one repo, and no help at all for a session you started by hand.

So Atrium stops trying to work out which conversation a tab had and decides it
instead. Every terminal tab is given a uuid when it is created, and the command
is rewritten on the way to the shell:

- first run: `claude --session-id <uuid>` — the tab claims the conversation
- afterwards: `claude --resume <uuid>` — the tab reopens its own

Which of the two is chosen comes from the main process, because Claude Code
keeps one JSONL per conversation under `~/.claude/projects` named by session
id, so "has this run before" is just whether that file exists. An explicit
`--resume`, `--continue` or `--session-id` from the user always wins; they may
be deliberately opening something else in that tab.

`restoreOverrides` in Settings stays for tools that need a different command on
restore, but is empty by default — a rewrite to `--continue` would now be
*less* accurate than the id, and would override it.

### Why this is done by rewriting the command, not by a shim

The first version put a `claude` wrapper on the session's PATH, which is how
cmux does it. That does not survive a login shell: `.zshrc` rebuilds PATH after
we set it, and a `~/.local/bin/claude` prepended there wins. Measured directly
— `command -v claude` inside a spawned session resolved to the real binary, not
the shim.

Rewriting the command Atrium types has no such problem. The shim is still
installed, and still binds sessions on setups whose rc files leave PATH alone,
but it is a fallback rather than the mechanism.

**The gap that remains:** a `claude` you type yourself in a tab is only bound
if the shim wins PATH. Closing that properly means shell integration — pointing
the shell at our own rc that sources the user's and then fixes PATH — which is
what editors do and is a larger piece of work.

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
