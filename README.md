# atrium

A desktop workspace for running several coding agents in parallel — one window,
a rail of sessions, each a real terminal in its own git worktree.

**Status: a working app, through stage 6.5 of 8.** Real processes on real
pseudo-terminals, a frameless Electron window, zsh and bash shell integration,
Claude lifecycle hooks reporting what each agent is doing, settings, and a
workspace that survives a restart. What remains is stage 7, a worktree per
session, and stage 8, deciding what happens to running agents when the app
quits. [`docs/plan/active/04-roadmap.md`](docs/plan/active/04-roadmap.md) has
the stage-by-stage detail.

`MockHost` still runs the whole interface in a browser tab against scripted
output. That is the design loop and a supported target that keeps the host seam
honest, not scaffolding left over from the mock.

```sh
npm install

npm run dev       # design loop in a browser tab, MockHost
npm run electron  # the real app: real PTYs, needs `npm run dev` running
npm test          # the suite; the run is the only count that cannot go stale
npm run pty:clean # see a raw pseudo-terminal work, nothing else in the way

npm run install:app  # build and install — /Applications, or a .deb via apt
npm run dist         # installers for this platform into release/
```

On Linux, `npm run electron` needs Electron's sandbox helper to be setuid root
once per checkout; the run tells you the two commands if it is not. See
[`docs/plan/active/08-packaging.md`](docs/plan/active/08-packaging.md).

`npm run electron` expects the dev server on :5173. For a standalone build,
`npm run electron:prod` bundles the renderer first.

**If the Electron window is blank and the console is silent, restart the dev
server** — a long-running Vite serving a stale module graph looks exactly like
a broken app.

## Developing Atrium inside Atrium

The dev build and the installed app run side by side. Nothing calls
`requestSingleInstanceLock`, and an unpackaged run moves its own state out of
the way — `main.ts` appends `-dev` to `userData` before `ready`, so the
installed app keeps `~/.config/atrium` (Application Support on macOS) and a dev
run gets `atrium-dev`: its own workspace, scrollback, shims and cookies. The
instance holding your agents cannot be overwritten by the one you are testing.

Two long-running commands, which is what a session with two tabs is for:

```sh
npm run dev       # vite on :5173 — leave it running
npm run electron  # the build under test; relaunch this per change
```

Only the second restarts as you work.

**Do not run `npm run install:app` from inside Atrium.** It replaces
`/opt/Atrium` (or the bundle in /Applications) underneath the process you are
working in. Iterate with `npm run electron`, and adopt a build from outside.

Two things to expect. `atrium-dev` starts empty, so the first dev launch has no
sessions rather than a copy of your workspace — that is the isolation working.
And the dev window carries a small yellow `dev` beside the wordmark, from the
same `app.isPackaged` bit that moved its `userData` aside; an unmarked title
bar is the installed app, holding your real agents. The taskbar icons are still
identical, so the title bar is what to check once both windows are open.

## Layout

```
src/
  host/
    types.ts    the Host interface — sessions, surfaces, git, files, notify, window
    context.ts  useHost() / useCapability()
    mock/       MockHost: a supported browser-tab implementation
  session/
    types.ts    the SessionDriver seam — UI above, platforms below
    mock.ts     scripted sessions, no processes
  layout/
    tree.ts     split/collapse operations on the pane tree
  dnd/
    DragContext.tsx   pointer-based drag with prioritised drop zones
  components/
    TitleBar.tsx      custom chrome; per-platform window-control insets
    Sidebar.tsx       the session rail; also a drop target
    PaneTree.tsx      recursive splits with draggable splitters
    PaneView.tsx      one leaf: tab bar + active tab + edge drop zones
    TabBar.tsx        tabs, drag handles, close buttons
    TerminalView.tsx  xterm.js, WebGL with a DOM fallback
    BrowserView.tsx   URL bar over a host-owned surface
    HostSurface.tsx   a box the host fills (iframe now, <webview> later)
  settings/           preferences; localStorage, not a host concern
  notifications.ts    state diffing, synthesised chimes
experiments/
  pty/          raw node-pty programs; not part of the app, but the same
                library it runs on
electron/
  main.ts       window, IPC, workspace file
  preload.ts    the contextBridge surface
  pty.ts        every live pseudo-terminal
  env.ts        the login environment a GUI app does not inherit
  App.tsx       swap MockDriver here to graduate to real PTYs
docs/plan/      active/ what is still open; completed/ what shipped
```

## Reading order

Plans are split by whether there is work left: [`docs/plan/active/`](docs/plan/active)
and [`docs/plan/completed/`](docs/plan/completed), indexed in
[`docs/plan/README.md`](docs/plan/README.md). The numbers are the reading order
and survive the split, so a gap in one folder is a document in the other.

1. [`active/00-overview.md`](docs/plan/active/00-overview.md) — what and why
2. [`completed/01-terminal-primer.md`](docs/plan/completed/01-terminal-primer.md) — how terminals actually work
3. [`active/02-decisions.md`](docs/plan/active/02-decisions.md) — Electron vs Tauri, why not fork cmux
4. [`active/03-architecture.md`](docs/plan/active/03-architecture.md) — the seam, cross-platform table
5. [`active/04-roadmap.md`](docs/plan/active/04-roadmap.md) — the eight stages
6. [`completed/05-ui-model.md`](docs/plan/completed/05-ui-model.md) — sessions, panes, tabs, drag, notifications
7. [`completed/06-host-interface.md`](docs/plan/completed/06-host-interface.md) — the cross-platform host seam
8. [`completed/07-persistence.md`](docs/plan/completed/07-persistence.md) — restore, and what it cannot do
9. [`active/08-packaging.md`](docs/plan/active/08-packaging.md) — bundling, installing, signing
10. [`active/12-agent-state.md`](docs/plan/active/12-agent-state.md) — what a tab knows about its agent, and how well
11. [`active/13-dogfooding.md`](docs/plan/active/13-dogfooding.md) — what developing Atrium in Atrium has turned up
