# Roadmap

Each stage produces something visible. Do not skip ahead — the later stages
only make sense once the earlier ones have been felt.

### ✅ Stage 1 — UI mock in a browser

Vite + React + xterm.js, `MockDriver` playing scripted agent output. No
processes, no Electron. Iterate here as long as it is still teaching you
something about the interface.

Shipped: session rail with derived state, split panes as a binary tree,
tabs (terminal and browser) that drag to reorder, to split, or onto the rail
to become their own session, resizable splitters, Escape-to-interrupt,
`×`-to-kill, and system notifications with synthesised sounds. See
`05-ui-model.md`.

### Stage 2 — see a real PTY, outside this project

Thirty lines of Node in a scratch directory: `npm i node-pty`, spawn `zsh`,
print raw output, write `"ls\n"` into it. The goal is to watch escape codes
flow, not to build anything.

### Stage 3 — a real terminal in a browser tab

Scratch project: a ~40-line WebSocket server. `ws.on('message') → pty.write`,
`pty.onData → ws.send`, xterm.js on the other end. This is the core of the
product, proven in isolation.

### Stage 4 — resize

Wire cols/rows through and watch `vim` go from broken to correct. Now SIGWINCH
means something.

### Stage 5 — `NodePtyDriver` in Atrium

Implement `SessionDriver` against node-pty and swap the one line in `App.tsx`.
Nothing above the seam should change. If it does, the seam was wrong.

### Stage 6 — wrap in Electron

Frameless window, `titleBarStyle: 'hidden'` + `titleBarOverlay`. It will break
when you launch the built app instead of `npm run dev` — that is the macOS PATH
problem from `03-architecture.md`, and you will already know the fix.

### Stage 7 — worktrees

Each session gets its own `git worktree`. Creation, listing, cleanup. Now it is
Atrium rather than a terminal with tabs.

### Stage 8 — lifecycle

Quit the app with agents running, then `ps -o pid,pgid,command`. The orphans
you find are what open question **O1** is actually about. Decide daemon or no
daemon with evidence in hand.

## Later, unscheduled

- Windows port (forces the abstraction honest — do it before Linux).
- Linux port (mostly free once Windows is done).
- Diff review pane per session, as a third tab kind.
- Command palette (⌘K is already reserved in the title bar).
- Persist layout across reloads.
- Real `<webview>` browser tabs once Electron lands, replacing the iframe.
