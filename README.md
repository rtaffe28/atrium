# atrium

A desktop workspace for running several coding agents in parallel — one window,
a rail of sessions, each a real terminal in its own git worktree.

**Status: stage 1 of 8.** This is a UI mock. There are no real processes; a
`MockDriver` plays scripted agent output so the interface can be designed at
browser speed before any systems work. See [`docs/plan/`](docs/plan).

```sh
npm install
npm run dev
```

## Layout

```
src/
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
    BrowserView.tsx   URL bar + iframe (becomes <webview> under Electron)
  notifications.ts    state diffing, synthesised chimes
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
