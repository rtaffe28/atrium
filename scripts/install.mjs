/**
 * Build Atrium and install it, the way the host platform installs things.
 *
 * For local use. There is no signing identity and no repository here, so both
 * paths are the unofficial one: a bundle copied into place on macOS, a .deb
 * handed to dpkg on Linux. See docs/plan/active/08-packaging.md.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });

/** No signing identity on this machine; asking for one just fails the build. */
const UNSIGNED = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };

function build(...args) {
  console.log('▸ building');
  run('npm', ['run', 'build']);
  run('npm', ['run', 'electron:build']);
  run('npx', ['electron-builder', ...args], { env: UNSIGNED });
}

function installMac() {
  const APP = 'Atrium.app';
  const built = join('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', APP);
  const target = join('/Applications', APP);

  build('--mac', '--dir');

  if (!existsSync(built)) {
    console.error(`✗ no app at ${built}`);
    process.exit(1);
  }

  // Replacing a running bundle leaves the old process with half-deleted files.
  try {
    execSync(`osascript -e 'tell application "Atrium" to quit'`, { stdio: 'ignore' });
    execSync('sleep 2');
  } catch {
    // Not running.
  }

  if (existsSync(target)) {
    console.log('▸ removing previous install');
    rmSync(target, { recursive: true, force: true });
  }

  console.log('▸ installing to /Applications');
  run('cp', ['-R', built, target]);

  // Ad-hoc sign so macOS treats it as a stable identity rather than
  // re-prompting about an unsigned binary on every launch.
  try {
    run('codesign', ['--force', '--deep', '--sign', '-', target], { stdio: 'ignore' });
    console.log('▸ ad-hoc signed');
  } catch {
    console.warn('▸ ad-hoc signing failed; the app will still run');
  }

  console.log(`\n✓ installed ${target}`);
  console.log('  open -a Atrium');
}

/**
 * Linux installs through the package manager, which is not a detour.
 *
 * dpkg is what puts the .desktop entry and the themed icons where the desktop
 * looks for them, and — the part that matters — it runs the maintainer script
 * that gives chrome-sandbox the mode this kernel actually needs: setuid root
 * where user namespaces are unavailable, plain 0755 where they are not. That
 * is a decision made as root at install time, so an app copied into a
 * directory by hand cannot make it, and refuses to start without it.
 */
function installLinux() {
  build('--linux', 'deb');

  const debs = readdirSync('release').filter((name) => name.endsWith('.deb'));
  if (debs.length === 0) {
    console.error('✗ no .deb in release/');
    process.exit(1);
  }
  const deb = join('release', debs.sort().at(-1));

  console.log(`▸ installing ${deb} (sudo)`);
  try {
    // apt rather than dpkg: it resolves the runtime dependencies fpm recorded,
    // where dpkg would leave the package half-configured and say so cryptically.
    run('sudo', ['apt-get', 'install', '-y', `./${deb}`]);
  } catch {
    console.error(`\n✗ install failed. To do it by hand:\n  sudo apt-get install ./${deb}`);
    process.exit(1);
  }

  console.log('\n✓ installed');
  console.log('  atrium');
}

if (process.platform === 'darwin') installMac();
else if (process.platform === 'linux') installLinux();
else {
  console.error(`✗ no install path for ${process.platform} yet — try: npm run dist`);
  process.exit(1);
}
