// node-pty ships prebuilt binaries, but npm's tarball extraction drops the
// execute bit on `spawn-helper`. Every spawn then fails with a bare
// "posix_spawnp failed", which looks like a bug in your code and is not — the
// tell is that /bin/echo fails identically.
//
// Runs on postinstall so `npm ci` cannot silently undo it. Expect the same
// class of problem when packaging: native helpers must keep their permissions
// through asar packing and code signing.

import { chmodSync } from 'node:fs';
import { glob } from 'node:fs/promises';

let fixed = 0;
for await (const path of glob('node_modules/node-pty/**/spawn-helper')) {
  chmodSync(path, 0o755);
  console.log(`chmod +x ${path}`);
  fixed += 1;
}
if (fixed === 0) console.log('no spawn-helper found (non-macOS, or not installed yet)');
