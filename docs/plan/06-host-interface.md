# The host interface

`SessionDriver` was the first seam; it only covered PTYs. Browser tabs broke
it — `BrowserView` reached for an iframe directly, which is a platform
assumption sitting inside a component. `Host` is the general version.

```ts
interface Host {
  capabilities: Capabilities   // what this host can actually do
  sessions: SessionDriver      // PTYs
  surfaces: SurfaceDriver      // embedded web content
  git: GitDriver               // worktrees, status, diff
  files: FileDriver            // read, write, watch
  notify: NotifyDriver         // native notification + sound
  window: WindowDriver         // platform, chrome insets, focus
}
```

Two implementations are planned. `MockHost` runs in a browser tab and is a
**supported target, not scaffolding** — it stays maintained so the design loop
never slows to Electron restart speed, and so a hosted version stays possible.
`ElectronHost` comes at stage 6.

## Three rules that let this survive real IPC

**1. Async and serializable.** Electron's `contextBridge` cannot pass
functions, class instances, or synchronous getters. Every method returns a
promise, every payload is plain JSON, every event is `subscribe() →
unsubscribe`. An interface that takes shortcuts here silently fails to move.

High-frequency PTY output is the deliberate exception: it gets its own channel
rather than being pushed through request/response.

**2. Capability-checked, not platform-sniffed.** `useCapability('files')` reads
as a question at the call site. Two hosts on the same OS can differ, so the app
reacts to what it is told, never to what it guesses. A driver whose capability
is false throws `UnsupportedError` — the capability flag is the contract, the
throw is the backstop.

**3. Injected, never imported.** One `HostProvider` at the root; components
reach it with `useHost()`. That is what makes the two implementations
interchangeable and what lets one test suite run against both — see
`src/host/host.test.tsx`, which swaps in hosts with different capabilities and
asserts the UI degrades rather than breaks.

## Surfaces invert the pattern

Everything else in `Host` is *data the app renders*. A surface is *an element
the host owns*.

So the app renders `<HostSurface id={tabId} url={url} />` — a box — and the
host fills it: an iframe today, a `<webview>` under Electron. `mount()` is the
one place a DOM node crosses the boundary, which is fine because surfaces are
renderer-side on every host planned. Only the control traffic (`navigate`,
`back`, `reload`) and the event stream (`title`, `url`, `loading`) ever need to
become IPC.

This is also the escape hatch if terminals ever move to a native renderer.

## Where the line falls

| Concern | Lives in | Why |
|---|---|---|
| Pane and tab layout | App | Pure UI state; no platform involvement |
| Which agent states are worth interrupting for | App | Policy |
| Delivering a notification and playing a tone | Host | Mechanism |
| Detecting the platform | Host | Components must never sniff a user agent |
| Window-control insets | Host | A browser tab reports 0, a frameless window reports the truth |
| Creating a worktree | Host | Touches the machine |

The notification split is the clearest case: `useAgentNotifications` decides
that `waiting` outranks `working` and writes the copy; `host.notify` decides
whether that becomes a Web Notification or a native one.

## Current capability matrix

| Capability | MockHost | ElectronHost (planned) |
|---|---|---|
| `pty` | false — scripted output | true |
| `browserSurface` | `iframe` | `webview` |
| `git` | true — in-memory worktrees | true |
| `files` | false | true |
| `nativeNotifications` | if the browser allows | true |
| `customChrome` | false | true |

`files: false` is load-bearing, not an omission: it is the capability that
proves degradation works, and the app must keep running without it.
