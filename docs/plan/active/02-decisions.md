# Decisions

## D1 — Electron, not Tauri

**Decided.** The goal is one interface that is identical on three platforms,
and the author is new to systems programming. Both point the same way.

| | Electron | Tauri |
|---|---|---|
| Renderer | one Chromium everywhere | WKWebView / WebView2 / **WebKitGTK** |
| PTY | `node-pty` — what VS Code ships | `portable-pty` — good, but you are on your own |
| Reference impl | VS Code's terminal *is* xterm.js + node-pty | none at this shape |
| New things to learn | 0 | Rust + Tauri + PTY, simultaneously |
| Bundle | ~150 MB | ~10 MB |

The memory argument for Tauri is weaker than it looks. Every agent we spawn is
itself a Node process burning 100–300 MB, so Electron's shell is roughly 10% of
total footprint once three sessions are live — not the dominant term. Tauri's
win is real but small; its costs land exactly on the two stated goals.

WebKitGTK was the deciding factor. It lags on CSS, renders fonts differently,
has flaky GPU compositing, and ships at whatever version the user's distro
chose. "Identical on Linux" and "Tauri" are in direct tension.

## D2 — Do not fork cmux

Investigated on 2026-09-10. Findings:

- cmux is **64% Swift**, a native macOS app built on **Ghostty** (Zig). HTML,
  CSS and JS together are ~1%. There is no web UI to carry across — a "port"
  would be a from-scratch rewrite sharing only ideas.
- It would also be a *downgrade*: replacing a GPU-accelerated native renderer
  with xterm.js in a webview.
- **License is GPL-3.0-or-later**, plus a CLA, with Manaflow reserving separate
  commercial terms. Reading it to learn is free; shipping a derived work means
  shipping GPL-3.0.
- The project's own cross-platform answer is **`cmux-tui`, written in Rust**,
  with 286+ merged PRs and an active hosted Windows CI lane. Linux GUI support
  is still open as issue #330.
- Velocity is at PR #12131 with 27k stars. A fork diverges permanently within
  weeks.

**Conclusion:** read cmux for ideas, build ours fresh. If the goal ever becomes
"cmux, everywhere" rather than "a better interface", contributing to `cmux-tui`
is the higher-leverage move.

## D3 — UI first, with a mock driver

Because the interface is the product, the interface gets built first — as a
plain Vite + React app in a browser tab, with scripted sessions. Browser hot
reload beats restarting an Electron shell, and the design can churn for days
without touching a single systems problem.

The `SessionDriver` interface in `src/session/types.ts` is the seam. Swapping
`MockDriver` for `NodePtyDriver` is the entire graduation from mock to product.

## D4 — Same design language, native chrome

One Chromium gets us layout, CSS, animation and the component tree for free.
Four things still differ and are handled explicitly rather than flattened:

- **Window chrome** — traffic lights top-left on macOS, controls top-right on
  Windows/Linux. Handled by the `--chrome-lead` / `--chrome-trail` tokens in
  `index.css` and the `platform-*` class on `TitleBar`.
- **Fonts** — bundle both UI and mono faces. Rendering still differs
  (DirectWrite vs FreeType vs CoreText); text reads slightly heavier on macOS
  and that is not fixable, only compensated.
- **Menus** — genuinely native. Keep the native menu minimal, put the real
  surface in a command palette.
- **Keybindings** — ⌘ vs Ctrl. **Do not flatten this one.** Honouring the
  platform convention costs one modifier token.

Flattening real platform conventions makes an app feel broken, not consistent.

## Open questions

- **O1 — Where do the PTYs live?** Children of the Electron main process
  (simple; quitting kills every agent) or a detached daemon the GUI attaches to
  (tmux's model; survives restarts, keeps scrollback). See `03-architecture.md`.
  Deferred until stage 5, but the seam is built so it stays cheap.
- **O2 — Do we bundle a font, or accept three looks?** Leaning bundle.
- **O3 — Worktree lifecycle.** Only live if Atrium ever creates worktrees
  itself, which is now an unscheduled convenience rather than a stage — see
  `04-roadmap.md`. A session pointed at a worktree the user made raises none of
  it: who creates them, who cleans them up, and what happens to one whose agent
  crashed are all answered by whoever made it.
