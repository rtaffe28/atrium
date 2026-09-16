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
const { chmodSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') return;

  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');

  const helper = join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
    `${context.electronPlatformName}-${context.arch === 1 ? 'x64' : 'arm64'}`,
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
