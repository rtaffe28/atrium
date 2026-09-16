/**
 * Build Atrium and install it into /Applications.
 *
 * For local use. Without an Apple Developer ID the bundle is unsigned, which
 * macOS tolerates for an app built on the same machine but not for one that
 * arrives over the network — see docs/plan/08-packaging.md.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'Atrium.app';
const BUILT = join('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', APP);
const TARGET = join('/Applications', APP);

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });

console.log('▸ building');
run('npm', ['run', 'build']);
run('npm', ['run', 'electron:build']);
run('npx', ['electron-builder', '--mac', '--dir'], {
  // No signing identity on this machine; asking for one just fails the build.
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});

if (!existsSync(BUILT)) {
  console.error(`✗ no app at ${BUILT}`);
  process.exit(1);
}

// Replacing a running bundle leaves the old process with half-deleted files.
try {
  execSync(`osascript -e 'tell application "Atrium" to quit'`, { stdio: 'ignore' });
  execSync('sleep 2');
} catch {
  // Not running.
}

if (existsSync(TARGET)) {
  console.log('▸ removing previous install');
  rmSync(TARGET, { recursive: true, force: true });
}

console.log('▸ installing to /Applications');
run('cp', ['-R', BUILT, TARGET]);

// Ad-hoc sign so macOS treats it as a stable identity rather than re-prompting
// about an unsigned binary on every launch.
try {
  run('codesign', ['--force', '--deep', '--sign', '-', TARGET], { stdio: 'ignore' });
  console.log('▸ ad-hoc signed');
} catch {
  console.warn('▸ ad-hoc signing failed; the app will still run');
}

console.log(`\n✓ installed ${TARGET}`);
console.log('  open -a Atrium');
