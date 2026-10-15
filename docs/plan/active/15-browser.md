# The browser pane

A browser tab sits beside an agent for the thing it just started — a dev
server, a preview, a page it was told to look at. Its toolbar is the one VS
Code's integrated browser and Cursor's share, because it is the one anyone
opening it already knows: back, forward and reload on the left; the address
bar taking the width, with the spinner inside it; the page's tools on the
right — developer tools, and open in your real browser. Back and forward are
greyed until there is somewhere to go. The tab is named after the page, as an
editor tab there is, with the host standing in until the page sends a title.

## The rule: the surface owns the URL

Traffic between the app and the embedded page runs one way in each direction
and never round-trips.

- **Down: the user asks.** Enter in the address bar, Back, Forward, Reload —
  each is a `host.surfaces` call. The only URL ever written into a surface is
  one the user typed, or the one a tab was opened on.
- **Up: the page reports.** Every navigation the page makes for itself — a
  clicked link, a redirect, a hash change — arrives as a `url` event, with
  whether it can go back or forward. The app records it on the tab, so the
  address bar, the title and the saved workspace follow, and does nothing
  else with it.

Before this the record was pushed back down: `HostSurface` watched the tab's
URL and set the webview's `src` whenever it changed. Electron reloads a
webview whose `src` is assigned its own value, so every click inside a page
loaded it twice, and a page that lands somewhere new each time it loads — a
login redirect carrying a fresh token, a cache-busting query — reloaded
forever. That was the browser pane flickering until its tab was closed.
`src/components/BrowserView.test.tsx` holds the regression test: a URL the
page reports must never come back to it as a navigation.

Smaller things from the same pass, each found by driving the real app over
the DevTools protocol against a local server built to trigger the loop:

- A surface's listeners now outlive its mount. The drivers used to drop the
  whole entry when a surface unmounted, so a subscriber attached earlier was
  left on an orphaned set until something made it resubscribe — and React's
  development mode mounts every new surface twice, so a freshly opened tab's
  first page reported to nobody. Events from a replaced webview are dropped.
- `did-navigate-in-page` fires for every frame in the page, so a hash change
  inside an embedded iframe used to become the tab's URL; only the main frame
  counts now.
- The one-shot focus request for a new tab is claimed in an effect, as the
  terminal does, not during render: development mode renders twice and keeps
  the second result, which found the request already spent. The focus test
  now runs under StrictMode.
- Chromium announces a title only when it changes, so a reload said nothing
  and the tab fell back to its host. The driver asks for the title once a
  load is done, and the pane resets a name only when the site changes.
- Each browser tab has its own address bar, so switching tabs in a pane no
  longer carries over the last one's draft, spinner and history.
- Chromium skips history entries a page left without a user gesture, so Back
  stays disabled after a scripted navigation. That is Chromium's history
  manipulation intervention, not the pane; a real click enables it.

## Not copied, and why

- **The engine.** VS Code's page is a native Electron view positioned over
  the editor area; Atrium's is a `<webview>` tag, which Electron discourages
  but which lays out as an element and so composes with splits, drag previews
  and the settings modal for free. A native view means syncing bounds over
  IPC and reasoning about z-order for everything drawn over a pane. Not worth
  it until the tag breaks.
- **Favourites, history, web search from the address bar.** Each of VS Code's
  is backed by a store the editor already has. A pane beside an agent is for
  the server it just started; an entry without a scheme becomes `http://`,
  and that is the whole address-bar policy.
- **Chat tools.** Cursor's Select Element and VS Code's Add to Chat send DOM
  and screenshots to their agent. Atrium's agents are terminals; the
  equivalent is a path or URL pasted into one, and a page can already be
  opened beside the tab that printed it.

## Next

- Developer tools open in their own window, which is what Electron offers a
  `<webview>` guest. Cursor and VS Code dock theirs; that needs the engine
  change above, or a second surface in the pane.
- The page's favicon in the tab, from `page-favicon-updated`.
- A shortcut to the address bar. `Mod+L` is the obvious one and is clear on
  macOS; on Linux `Ctrl+L` is clear-screen in a terminal tab, so it has to be
  scoped to browser tabs — `10-keyboard.md` has the rule.
- Reload should read Stop while the page is loading.
