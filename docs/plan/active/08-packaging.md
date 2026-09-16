# Packaging and installing

```sh
npm run install:app   # build and install, the way this platform installs things
npm run dist          # build installers for the host platform into release/
npm run dist:dir      # unpacked app only — fastest way to test packaging
npm run dist:mac      # or dist:linux, to name a platform explicitly
```

`install:app` means `/Applications` on macOS and a `.deb` handed to `apt` on
Linux. It used to mean only the first of those, on every platform, which on
Linux built a macOS bundle and then failed to copy it into a directory that
does not exist.

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

## Linux, and the second helper binary

The `.deb` builds and installs. Two things about it are worth knowing.

**There is no `spawn-helper` here.** node-pty ships prebuilds for darwin and
win32 only; on Linux it compiles from source and calls `forkpty` directly. The
`after-pack` hook returns early rather than warning about a file that was never
meant to exist — a build log that cries wolf about the native helper is worse
than one that says nothing, because the real warning is the one you stop
reading.

**`chrome-sandbox` is the same lesson as `spawn-helper`, one step further.**
Electron's sandbox helper needs to be root-owned and setuid, npm's extraction
cannot make it so, and neither can `postinstall` — chown to root needs root. A
dev launch from the source tree therefore aborts with a C++ `FATAL`, printed
after the window has already failed to open:

```
The SUID sandbox helper binary was found, but is not configured correctly.
```

`scripts/native-permissions.mjs` runs before `npm run electron` and says so
first, in a sentence, with the two commands that fix it:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`npm run electron -- --no-sandbox` gets past it without root, at the cost of
running the renderer unsandboxed.

The packaged app never has this problem, and the reason is instructive: its
`postinst` runs as root and picks the mode from the kernel it finds — setuid
where user namespaces are unavailable, plain `0755` where they work and
Chromium can use the namespace sandbox instead. That is a decision only an
installer can make.

## Windows

Configured but unbuilt. `electron-builder --win` produces an NSIS installer.
Windows needs no `spawn-helper` fix (ConPTY is a system API) but does want
Authenticode signing. Expect the `MAX_PATH` and long-paths issues from
`03-architecture.md` to show up there first.
