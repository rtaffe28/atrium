# What to take from VS Code and cmux

Atrium sits between them. VS Code is a workspace that happens to contain
terminals; cmux is an agent runner that happens to look like a terminal. Atrium
wants VS Code's pane and workspace model with cmux's agents as the thing being
arranged.

The useful pattern in both, and the one worth generalising: **they replace
guesses with reported facts.** Nearly every bug in this app so far came from
inferring something a component could simply have been asked.

## Taken already

**Shell integration (VS Code, OSC 633 / OSC 133).** The shell announces each
command line and its exit code. This replaced two heuristics that were both
observably wrong: the pty's foreground process name, which lies when a process
renames itself — Claude Code reports as its own version number, and `2.1.273`
was recorded as a tab's command — and a command reassembled keystroke by
keystroke, which one control character invalidated. Exit codes came free, and
with them an agent tab that can distinguish finishing from failing.

**Session binding (cmux).** Its wrapper's header says it plainly: intercept the
agent and inject `--session-id`. Deciding the conversation up front is what
makes restore exact, where resuming "the most recent in this directory" is
already wrong with two tabs open on one repo.

**ZDOTDIR shell integration (both).** cmux's `.zshenv` hands ZDOTDIR back
*before* sourcing anything, and its comment explains why: `/etc/zshrc` derives
HISTFILE from it. Ours held onto it and was quietly writing the user's shell
history into a temp directory. Reading someone else's solution found a bug that
testing had not.

**Agent hooks, for state that is reported rather than inferred (cmux).** Taken,
then mostly withdrawn. The hooks reported what the agent was doing, but only
for Claude. Tabs now show what any program sends its terminal, which is what
Ghostty does and needs no hook per agent. What is kept is `SessionStart`,
registered through a `--settings` file the shim hands `claude`: it fires for a
conversation however it began, which is what makes restore reopen the right
one. See [`12-agent-state.md`](12-agent-state.md).

## Worth taking next

**Command navigation and re-run (VS Code).** The OSC 133 marks are already
arriving and are currently only used for state. The same marks give jump to
previous or next command, select a command's output, re-run it, and sticky
scroll showing the running command at the top of a long output. The data is
already there; only the UI is missing.

**A command palette (VS Code).** ⌘K is reserved in the title bar and does
nothing. Switching sessions, creating one in a chosen directory, splitting,
and changing the agent are all buried in clicks. This is the cheapest large
improvement to how the app feels.

## Where the two disagree, and which to follow

**cmux keeps its terminal native (Ghostty); VS Code renders in a webview.**
Atrium follows VS Code, deliberately — the interface is the product here and
one identical surface on three platforms is worth more than glyph throughput.
See `02-decisions.md`.

**cmux gives every session its own `git worktree`.** Atrium takes the idea
without the enforcement. A session runs in the directory you point it at, and
pointing it at a worktree you made yourself is already the whole feature —
it is how this project is developed. One per session, created and owned by the
app, is not a thing to impose; the convenience version, an action that makes a
worktree and opens a session on it, is unscheduled. Sessions still carry a
`branch` field that nothing honours, which wants filling in from the directory
or removing.

**cmux binds a tab to a conversation for the tab's lifetime.** Atrium binds it
for a restore only. Exiting an agent and starting it again should give a new
conversation, not reopen the old one, and treating resume as a property of the
tab gets that wrong.
