/**
 * Restore the execute bit on node-pty's spawn-helper.
 *
 * This is the same failure that cost an hour in experiments/pty: npm's tarball
 * extraction drops the bit, and every spawn then dies with a bare
 * "posix_spawnp failed" that reads like a bug in your own code. Packing is
 * another place the bit can be lost, and a packaged app that cannot open a
 * terminal is a very expensive thing to discover after shipping.
 *
 * Cheap to assert, so assert it.
 */
const { execFileSync } = require('node:child_process');
const { chmodSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  // Only macOS has a spawn-helper to lose: node-pty ships prebuilds for darwin
  // and win32 only, compiles from source on Linux, and calls forkpty directly
  // there. Warning about a missing helper on Linux reports a problem that does
  // not exist, in the one place a real one would be easy to miss.
  if (context.electronPlatformName !== 'darwin') return;

  adhocSign(context);

  const helper = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${context.arch === 1 ? 'x64' : 'arm64'}`,
    'spawn-helper',
  );

  if (!existsSync(helper)) {
    console.warn(`[after-pack] no spawn-helper at ${helper} — terminals may not spawn`);
    return;
  }

  chmodSync(helper, 0o755);
  const mode = statSync(helper).mode & 0o777;
  console.log(`[after-pack] spawn-helper mode ${mode.toString(8)}`);
};

/**
 * Ad-hoc sign the bundle when there is no Developer ID.
 *
 * Packing replaces resources inside an app that Electron already signed, which
 * leaves the original signature describing files that are no longer there.
 * `spctl` then reports "code has no resources but signature indicates they
 * must be present" and Gatekeeper refuses it — the app still launches locally
 * only because a locally built bundle is never quarantined.
 *
 * A real Developer ID replaces this entirely; electron-builder signs and this
 * is skipped.
 */
function adhocSign(context) {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false' && process.env.CSC_LINK) return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(app)) return;

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
    console.log('[after-pack] ad-hoc signed');
  } catch (error) {
    console.warn('[after-pack] ad-hoc signing failed:', error.message);
  }
}
