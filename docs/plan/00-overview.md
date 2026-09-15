# Atrium — overview

A desktop workspace for running several coding agents in parallel: one window,
a rail of sessions, each session a real terminal attached to a real agent CLI
in its own git worktree.

Prior art is [cmux](https://github.com/manaflow-ai/cmux). The thesis here is
different in one specific way: **the interface is the product**. cmux is a
native macOS app built on Ghostty, and it is excellent at being a terminal.
Atrium trades native fidelity for a single interface that is pixel-identical
on macOS, Windows and Linux, because the thing being designed is the
multi-session workflow, not the glyph renderer.

## What it has to do

- Run N agent sessions at once, each in its own worktree, each with a real PTY.
- Make the state of all N legible at a glance — what is working, what finished,
  and above all **what is blocked waiting on a human**.
- Survive the app closing without killing the agents.
- Look and behave the same on all three platforms.

## What it deliberately is not

- Not a better terminal emulator. xterm.js is good enough; Ghostty already won
  that race and we are not entering it.
- Not a tmux replacement. Sessions are agent-shaped, not pane-shaped.
- Not cross-platform by accident. See `02-decisions.md`.

## Where the project is right now

**Stage 1 of 8** — a UI mock running in a browser tab, with a `MockDriver`
producing scripted agent output. No processes, no PTYs, no Electron. The point
is to iterate on the interface at browser speed before paying for any systems
work. See `04-roadmap.md`.
