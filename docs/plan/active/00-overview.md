# Atrium — overview

A desktop workspace for running several coding agents in parallel: one window,
a rail of sessions, each session a real terminal attached to a real agent CLI
in a directory you choose.

Prior art is [cmux](https://github.com/manaflow-ai/cmux). The thesis here is
different in one specific way: **the interface is the product**. cmux is a
native macOS app built on Ghostty, and it is excellent at being a terminal.
Atrium trades native fidelity for a single interface that is pixel-identical
on macOS, Windows and Linux, because the thing being designed is the
multi-session workflow, not the glyph renderer.

## What it has to do

- Run N agent sessions at once, each on its own real PTY, each rooted wherever
  you point it — a repo, a subdirectory, a worktree you made yourself.
- Give each session a workspace, not a single terminal: split panes, each with
  tabs, each tab a terminal or a browser. Tabs drag between panes, split on
  drop, or graduate into a session of their own.
- Make the state of all N legible at a glance — what is working, what finished,
  and above all **what is blocked waiting on a human** — and say so out loud
  with a system notification when it changes.
- Survive the app closing without killing the agents.
- Look and behave the same on all three platforms.

## What it deliberately is not

- Not a better terminal emulator. xterm.js is good enough; Ghostty already won
  that race and we are not entering it.
- Not a tmux replacement. Sessions are agent-shaped, not pane-shaped.
- Not cross-platform by accident. See `02-decisions.md`.

## Where the project is right now

**Stage 6.5 of 7** — a working Electron app: real processes on real
pseudo-terminals, shell integration under zsh and bash, Claude lifecycle hooks
reporting what each agent is doing, settings, and a workspace that restores
across restarts. `MockHost` still runs the whole interface in a browser tab
against scripted output, and stays a supported target rather than scaffolding.

What remains is stage 7, lifecycle: what happens to running agents when the app
quits.

The interface model — sessions, split panes, tabs, drag targets, derived state
and notifications — is documented in `../completed/05-ui-model.md`. See `04-roadmap.md` for
what comes next.
