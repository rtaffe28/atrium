# UI model — sessions, panes, tabs

The shape settled in stage 1. A session is no longer one terminal; it is a
workspace.

```
Session                     one task, one branch, one worktree
 └── LayoutNode             binary tree of splits
      ├── leaf → TabGroup   a pane: one tab bar + the active tab
      │            └── Tab  terminal | browser
      └── split             row or column, with draggable sizes
```

## Why a binary tree

Splits are a tree, not a grid. Modelling them as one means "drop a tab on the
left edge of this pane" is a single operation — wrap that leaf in a split node —
rather than a special case per arrangement. Closing the last tab in a pane
collapses the branch back into its sibling automatically (`removeLeaf` in
`src/layout/tree.ts`). Arbitrary nesting comes free and no layout code knows
how deep it is.

The alternative — a flat list of panes with explicit coordinates — needs
bespoke logic for every split-and-collapse case and breaks the moment nesting
goes two deep.

## Session state is derived, never stored

`deriveSessionState()` computes a session's state from its agent tabs:

    waiting  >  working  >  error  >  done  >  idle

**"Needs input" outranks everything.** It is the only state where a human is
the bottleneck, so it must win the rail's attention — a session with one
blocked agent and four busy ones is a session that needs you *now*.

Storing session state separately would mean keeping it in sync with the tabs,
and it would go stale the first time a tab moved between sessions. Deriving it
means a tab dragged to a new session carries its state with it for free.

## Drag and drop

Pointer events, not HTML5 drag-and-drop. HTML5 DnD cannot give a live
drop-zone preview that updates as the pointer crosses a pane's edges, and its
drag image is not stylable on every platform — which matters precisely because
the app is meant to look identical everywhere.

Drop zones register themselves with `DragProvider` and are hit-tested by
priority on every pointer move:

| Zone | Priority | Result |
|---|---|---|
| Session rail | 3 | Tab is promoted into a session of its own |
| Tab bar | 2 | Reorder within a pane, or move between panes |
| Pane body, outer 28% | 1 | Split on that edge |
| Pane body, centre | 1 | Move into that pane's tab bar |

A 5px slop threshold before the drag arms, so a click that wobbles still reads
as a click.

## Keys and controls

Deliberate choices, not defaults:

- **Escape interrupts** the agent rather than reaching the process. Agents
  treat a bare ESC as cancel, and it is the key users reach for without
  thinking — worth taking away from the PTY. Implemented via xterm's
  `attachCustomKeyEventHandler`.
- **X kills.** No Interrupt/Kill buttons: an `×` on the session row kills the
  session, an `×` on a tab closes the tab. Buttons for destructive actions
  belong on the thing they destroy.
- **⌘N / Ctrl+N** opens a session. The modifier follows the platform.

## Notifications

An agent that needs you is worthless if you are in another window. So:

| State | Sound | Why |
|---|---|---|
| `waiting` | three rising tones, loudest | you are the blocker |
| `done` | rising major third | finished, no action needed |
| `error` | falling minor | something broke |

Tones are synthesised with WebAudio — no asset to ship or license. The
notification itself is posted `silent: true` so the OS does not double up on
our own sound.

Notifications are produced by diffing sessions in `useAgentNotifications`,
*not* emitted by the driver. That keeps the driver ignorant of presentation,
so the real PTY driver gets notifications for free without ever knowing they
exist.

First render is skipped ("priming"), or every seeded session would fire at
once on load.

## Known mock limitations

- **Browser tabs are iframes.** Any site sending `X-Frame-Options: DENY` — most
  of them — refuses to render. Under Electron this becomes a `<webview>`, which
  has no such restriction. Local dev servers, the actual use case, iframe fine.
- **Cross-session tab drags** only work via the rail. Dragging between two
  sessions' panes is impossible because only one session is visible at a time.
  Not a limitation worth fixing until there is a reason to show two.
