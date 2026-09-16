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
`../completed/05-ui-model.md`.

### ✅ Stage 1.5 — define the host interface

`Host` replaces the session-only seam: sessions, surfaces, git, files, notify,
window, behind one injected object with a capability matrix. `MockHost` runs in
a browser tab and stays a supported target. See `../completed/06-host-interface.md`.

### ✅ Stage 2 — see a real PTY, outside this project

Done, in `experiments/pty`. `hello-pty.mjs` spawns a shell on a PTY and prints
every chunk with control bytes made visible. Its README records what the output
proves: the shell believes it is on a tty,
SIGWINCH really resizes it, output arrives in arbitrary chunks that split
escape sequences mid-sequence, and your own keystrokes echo back through the
same loop.

These started as a separate repo, back when atrium was a browser-only Vite app
and adding `node-pty` for a learning exercise would have polluted its
dependencies. atrium depends on `node-pty` now, so that reason expired and they
moved in.

**Carry this one forward:** node-pty's prebuilt `spawn-helper` arrives without
its execute bit, because npm's tarball extraction drops it, and every spawn
then fails with a bare `posix_spawnp failed` that looks like a code bug. The
tell is that `/bin/echo` fails identically. `scripts/native-permissions.mjs`
fixes it on postinstall. Expect the same class of problem when packaging —
native helpers have to keep their permissions through asar packing and code
signing.

### Stage 3 — a real terminal in a browser tab

Scratch project: a ~40-line WebSocket server. `ws.on('message') → pty.write`,
`pty.onData → ws.send`, xterm.js on the other end. This is the core of the
product, proven in isolation.

### Stage 4 — resize

Wire cols/rows through and watch `vim` go from broken to correct. Now SIGWINCH
means something.

### ✅ Stage 5 — real PTYs in Atrium

Done, together with stage 6. `ElectronSessionDriver` implements `SessionDriver`
against node-pty in the main process. Nothing above the seam changed — the
session, tab and layout logic moved to `SessionStore`, which both drivers now
share, and the mock and the real thing differ only in where bytes come from.

### ✅ Stage 6 — wrap in Electron

Frameless window with `titleBarStyle: 'hidden'` plus `titleBarOverlay` off
macOS. The login-shell environment is resolved once at startup, so the PATH
problem is handled before it can bite.

**The trap this actually sprang:** a Vite dev server left running for four
hours across a refactor that renamed and deleted files served a stale module
graph. The window came up blank with no error anywhere — the HTML ran, the
preload bridge was present, and `main.tsx` simply never executed. Restarting
the dev server fixed it. If an Electron window is blank and the console is
silent, suspect the dev server before the app.

### ✅ Stage 6.5 — settings and persistence

A settings panel (⌘,) covering the default command for new sessions, alert
sounds (off by default), which states notify, and terminal font size. The
workspace persists and restores across restarts — see `../completed/07-persistence.md`,
including what restore cannot do.

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
