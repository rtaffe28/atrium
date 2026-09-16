/**
 * Permissions that an install drops, and that nothing else puts back.
 *
 * Two binaries, two platforms, one lesson: a native helper is only useful if
 * it keeps the bits it shipped with, and the tools in between do not think of
 * themselves as being in the permissions business.
 *
 * Runs on postinstall so `npm ci` cannot silently undo it, and again before
 * the dev app starts, because the second of these cannot be fixed here and
 * has to be said out loud at the moment it matters.
 */

import { chmodSync, statSync } from 'node:fs';
import { glob } from 'node:fs/promises';

/**
 * node-pty's `spawn-helper` (macOS).
 *
 * npm's tarball extraction drops the execute bit, and every spawn then fails
 * with a bare "posix_spawnp failed" that looks like a bug in your code and is
 * not — the tell is that `/bin/echo` fails identically. Linux does not use a
 * helper at all: node-pty compiles from source there and calls forkpty itself.
 */
async function spawnHelper() {
  let fixed = 0;
  for await (const path of glob('node_modules/node-pty/**/spawn-helper')) {
    chmodSync(path, 0o755);
    console.log(`chmod +x ${path}`);
    fixed += 1;
  }
  if (fixed === 0) console.log('no spawn-helper found (non-macOS, or not installed yet)');
}

const SANDBOX = 'node_modules/electron/dist/chrome-sandbox';

/**
 * Electron's `chrome-sandbox` (Linux).
 *
 * The same class of failure, one step further: npm cannot restore a setuid
 * root bit no matter what it extracts, and neither can this script — chown to
 * root needs root. So all that is possible is to say so before Electron does,
 * since what Electron says is a C++ FATAL with a stack trace, printed after
 * the window has already failed to open.
 *
 * The packaged .deb is unaffected: dpkg installs the binary as root and sets
 * the bit, which is why this only ever bites a dev run from the source tree.
 *
 * @returns whether the sandbox is usable
 */
function chromeSandbox() {
  let stats;
  try {
    stats = statSync(SANDBOX);
  } catch {
    return true; // Electron not installed yet; postinstall order, not a problem.
  }

  const setuidRoot = stats.uid === 0 && (stats.mode & 0o4000) !== 0;
  if (setuidRoot) return true;

  console.log(
    [
      '',
      "Electron's sandbox helper is not setuid root, so `npm run electron` will abort.",
      'Fix it once, per checkout:',
      '',
      `  sudo chown root:root ${SANDBOX}`,
      `  sudo chmod 4755 ${SANDBOX}`,
      '',
      'Or start the dev app without it: npm run electron -- --no-sandbox',
      '',
    ].join('\n'),
  );
  return false;
}

await spawnHelper();
if (process.platform === 'linux') chromeSandbox();
