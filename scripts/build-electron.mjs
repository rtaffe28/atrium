// Bundles the Electron main process and preload.
//
// Kept as an explicit esbuild call rather than a plugin so the two builds stay
// visible: main is ESM (it uses import.meta.url), preload is CJS because that
// is what contextIsolation expects to load. electron and node-pty are external
// — one is provided by the runtime, the other is a native module that cannot
// be bundled.

import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['electron', 'node-pty'],
  // Shell scripts ship as text, so they stay real files that a shell can
  // syntax-check rather than string literals nothing validates.
  loader: { '.sh': 'text', '.zsh': 'text' },
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.mjs',
  format: 'esm',
});

await build({
  ...shared,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  format: 'cjs',
});
