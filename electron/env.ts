import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The environment a GUI app does not inherit.
 *
 * Launched from Finder or the Dock, a macOS app gets a bare PATH from launchd —
 * no Homebrew, no nvm or asdf shims, no `claude`. It works under `npm run dev`
 * (that inherits your terminal) and breaks the moment you double-click the
 * bundle, which is why it is so often found late.
 *
 * Resolved once at startup and reused, because spawning a login shell per
 * session would re-source rc files every time and mangle argv.
 */

const START = '__ATRIUM_ENV_START__';
const END = '__ATRIUM_ENV_END__';

export async function resolveLoginEnv(): Promise<NodeJS.ProcessEnv> {
  // Windows inherits PATH from the registry correctly; nothing to do.
  if (process.platform === 'win32') return { ...process.env };

  const shell = process.env.SHELL ?? '/bin/zsh';
  try {
    // Sentinels rather than `env -0`: BSD env has no -0, and rc files print
    // their own noise that has to be discarded.
    const { stdout } = await run(
      shell,
      ['-ilc', `echo "${START}"; env; echo "${END}"`],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    );

    const body = stdout.slice(
      stdout.indexOf(START) + START.length,
      stdout.indexOf(END),
    );

    const resolved: NodeJS.ProcessEnv = { ...process.env };
    for (const line of body.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) resolved[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return resolved;
  } catch {
    // An rc file that blocks on input will hit the timeout. Degrading to the
    // inherited environment beats refusing to start.
    return { ...process.env };
  }
}
