# atrium

A desktop workspace for running several coding agents in parallel — one window,
a rail of sessions, each a real terminal in its own git worktree.

**Status: stage 1 of 8.** This is a UI mock. There are no real processes; a
`MockDriver` plays scripted agent output so the interface can be designed at
browser speed before any systems work. See [`docs/plan/`](docs/plan).

```sh
npm install

npm run dev       # design loop in a browser tab, MockHost
npm run electron  # the real app: real PTYs, needs `npm run dev` running
npm test          # 29 tests
```

`npm run electron` expects the dev server on :5173. For a standalone build,
`npm run electron:prod` bundles the renderer first.

**If the Electron window is blank and the console is silent, restart the dev
server** — a long-running Vite serving a stale module graph looks exactly like
a broken app.

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
electron/
  main.ts       window, IPC, workspace file
  preload.ts    the contextBridge surface
  pty.ts        every live pseudo-terminal
  env.ts        the login environment a GUI app does not inherit
  App.tsx       swap MockDriver here to graduate to real PTYs
docs/plan/      overview, terminal primer, decisions, architecture, roadmap,
                UI model
```

## Reading order

1. [`docs/plan/00-overview.md`](docs/plan/00-overview.md) — what and why
2. [`docs/plan/01-terminal-primer.md`](docs/plan/01-terminal-primer.md) — how terminals actually work
3. [`docs/plan/02-decisions.md`](docs/plan/02-decisions.md) — Electron vs Tauri, why not fork cmux
4. [`docs/plan/03-architecture.md`](docs/plan/03-architecture.md) — the seam, cross-platform table
5. [`docs/plan/04-roadmap.md`](docs/plan/04-roadmap.md) — the eight stages
6. [`docs/plan/05-ui-model.md`](docs/plan/05-ui-model.md) — sessions, panes, tabs, drag, notifications
7. [`docs/plan/06-host-interface.md`](docs/plan/06-host-interface.md) — the cross-platform host seam
8. [`docs/plan/07-persistence.md`](docs/plan/07-persistence.md) — restore, and what it cannot do
