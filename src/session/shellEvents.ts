/**
 * Shell integration events, in VS Code's OSC 633 / OSC 133 protocol.
 *
 * Everything Atrium knows about a terminal today is inferred. What command is
 * running comes from the pty's foreground process, which lies when a process
 * renames itself — Claude Code reports as its own version number, and that got
 * recorded as the command. What the user typed is reassembled keystroke by
 * keystroke, which a single control character invalidates. Whether a tab is
 * idle is a guess about output timing.
 *
 * None of that is necessary. A shell can simply say so, which is what VS Code's
 * integration does and why its terminal knows things ours has been estimating:
 *
 *   OSC 133 ; A    a prompt is being drawn
 *   OSC 133 ; C    a command is starting
 *   OSC 133 ; D ; n  the command finished with exit code n
 *   OSC 633 ; E ; cmd  the command line, verbatim
 *   OSC 633 ; P ; Cwd=path  where the shell is now
 *
 * Adopting the same codes rather than inventing our own means the integration
 * also works if the shell is opened somewhere that already speaks it.
 */

export type ShellEvent =
  | { type: 'prompt' }
  | { type: 'started'; command?: string }
  | { type: 'finished'; exitCode: number }
  | { type: 'cwd'; cwd: string };

export interface ShellEventScan {
  /** A partial sequence carried over from the previous chunk. */
  pending: string;
}

export const newShellEventScan = (): ShellEventScan => ({ pending: '' });

/* eslint-disable-next-line no-control-regex -- matching ESC and BEL is the job */
const OSC = /\x1b\](133|633);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const MAX_PENDING = 4096;

/**
 * Pull shell-integration events out of a chunk of terminal output.
 *
 * A pty splits wherever it likes, so a sequence routinely straddles two reads;
 * the unterminated tail is carried forward. The cap stops a stream that merely
 * looks like the start of a sequence from growing without bound.
 */
export function scanShellEvents(chunk: string, state: ShellEventScan): ShellEvent[] {
  const text = state.pending + chunk;
  const events: ShellEvent[] = [];
  let lastEnd = 0;

  OSC.lastIndex = 0;
  for (let match = OSC.exec(text); match; match = OSC.exec(text)) {
    lastEnd = match.index + match[0].length;
    const [, code, body] = match;
    const [kind, ...rest] = body.split(';');

    if (code === '633' && kind === 'E') {
      events.push({ type: 'started', command: decode(rest.join(';')) });
    } else if (code === '633' && kind === 'P') {
      // One property per sequence, as Key=Value. Rejoined rather than indexed
      // because a path may contain the separator.
      const property = rest.join(';');
      if (property.startsWith('Cwd=')) {
        events.push({ type: 'cwd', cwd: decode(property.slice(4)) });
      }
    } else if (code === '133') {
      if (kind === 'A') events.push({ type: 'prompt' });
      else if (kind === 'C') events.push({ type: 'started' });
      else if (kind === 'D') {
        events.push({ type: 'finished', exitCode: Number(rest[0] ?? 0) || 0 });
      }
    }
  }

  // Keep only a trailing fragment that could still become a sequence.
  const tail = text.slice(lastEnd);
  const start = tail.lastIndexOf('\x1b]');
  state.pending = start >= 0 && tail.length - start < MAX_PENDING ? tail.slice(start) : '';
  return events;
}

/** The shell escapes the command line, since it may contain anything. */
function decode(value: string): string {
  return value.replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
