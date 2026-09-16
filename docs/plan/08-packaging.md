# Packaging and installing

```sh
npm run install:app   # build and install into /Applications
npm run dist          # build a .dmg and .zip into release/
npm run dist:dir      # unpacked .app only — fastest way to test packaging
```

`npm run electron` is a *dev* launch: it loads the renderer from the Vite dev
server. Everything below is about the real bundle, which loads from disk and
behaves differently in ways that are easy to miss.

## What electron-builder does that matters here

**Rebuilds node-pty.** The prebuilt binary matches Node's ABI, not Electron's.
`@electron/rebuild` runs automatically before packaging.

**Unpacks it from the asar.** Nothing can `dlopen` or `exec` from inside an
archive, so `node_modules/node-pty/**` is listed under `asarUnpack` and ends up
in `app.asar.unpacked/`.

**Restores the execute bit on `spawn-helper`** via `build/after-pack.cjs`. This
is the same failure that cost an hour in `experiments/pty`: without the bit,
every spawn dies with a bare `posix_spawnp failed` that reads like a bug in
your own code. Packing is another place it can be lost, and a packaged app that
cannot open a terminal is an expensive thing to discover after shipping. The
hook prints the mode so it is visible in the build log.

## The trap that actually bit

The first packaged build opened a **blank window with nothing in the console**.

Vite defaults to absolute asset paths — `/assets/index-abc.js` — and a packaged
app loads the renderer over `file://`, where that resolves to the *filesystem
root*. The script never loads, so nothing runs and nothing logs. `base: './'`
in `vite.config.ts` fixes it.

The two `webContents` handlers kept in `main.ts` (`did-fail-load`,
`preload-error`) exist because of this: a packaged renderer that fails is
otherwise completely silent.

## Signing

There is no Developer ID on this machine, so builds are unsigned and
`install:app` ad-hoc signs (`codesign -s -`) so macOS treats the app as a
stable identity rather than re-prompting.

That is fine for an app built and run on the same machine. It is **not** enough
to give to anyone else: an unsigned bundle that arrives over the network is
quarantined and Gatekeeper refuses it. Distribution needs a Developer ID
Application certificate, `hardenedRuntime` (already configured) with
`build/entitlements.mac.plist`, and notarisation.

The entitlements are not decoration. A terminal needs JIT for V8,
`disable-library-validation` because node-pty loads a native module and execs a
separate helper, and `allow-dyld-environment-variables` for the login-shell
environment probe. The app is deliberately **not** sandboxed — a sandboxed app
cannot spawn arbitrary user tooling, which is the entire point of this one.

## Windows and Linux

Configured but unbuilt. `electron-builder --win` and `--linux` produce an NSIS
installer and AppImage/deb respectively. Windows needs no `spawn-helper` fix
(ConPTY is a system API) but does want Authenticode signing. Expect the
`MAX_PATH` and long-paths issues from `03-architecture.md` to show up there
first.
