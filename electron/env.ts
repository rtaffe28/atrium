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

/**
 * Markers that say "this process is running inside an agent session".
 *
 * Atrium inherits whatever environment it was launched from, and a login-shell
 * probe preserves it — so launching Atrium from inside a coding-agent session
 * used to hand every terminal it opened that session's identity. Claude Code
 * reads `CLAUDE_CODE_CHILD_SESSION`, concludes it is a nested invocation, and
 * turns off transcript saving and trust persistence. The visible symptom is an
 * agent that asks you to trust the same folder every single time and never
 * saves a conversation.
 *
 * A terminal emulator must hand over a clean shell. Anything that identifies
 * *our* launcher is not part of that.
 *
 * Note what is deliberately absent: ANTHROPIC_* and any other credential or
 * preference a user set for themselves. Those belong to the shell.
 */
const AGENT_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
];
const AGENT_SESSION_PREFIXES = ['CLAUDE_CODE_'];

/** Drop the launcher's agent-session identity from an environment. */
export function stripAgentSession(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (AGENT_SESSION_MARKERS.includes(key)) continue;
    if (AGENT_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    clean[key] = value;
  }
  return clean;
}

export async function resolveLoginEnv(): Promise<NodeJS.ProcessEnv> {
  // Windows inherits PATH from the registry correctly; nothing to do beyond
  // the stripping every platform needs.
  if (process.platform === 'win32') return stripAgentSession(process.env);

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
    // The probe inherits our environment before adding to it, so the markers
    // survive the round trip and have to be removed after, not before.
    return stripAgentSession(resolved);
  } catch {
    // An rc file that blocks on input will hit the timeout. Degrading to the
    // inherited environment beats refusing to start.
    return stripAgentSession(process.env);
  }
}
