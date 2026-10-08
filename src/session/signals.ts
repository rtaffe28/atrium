/**
 * What a program in a terminal says to the terminal on purpose.
 *
 * Atrium does not work out what an agent is doing. Every attempt to — output
 * timing, process activity, one agent's lifecycle hooks — was either wrong or
 * covered one agent. A terminal is not in that business. Ghostty, iTerm2 and
 * kitty show what a program asks them to show, and nothing else, so they are
 * never wrong about it. These are the requests:
 *
 *   BEL                     ring: look at me
 *   OSC 9 ; body            a desktop notification (iTerm2)
 *   OSC 777 ; notify ; title ; body   the same (rxvt, Ghostty)
 *   OSC 99 ; meta ; payload the same, chunked (kitty)
 *   OSC 9 ; 4 ; state ; n   progress: a bar, a spinner, or nothing (ConEmu)
 *   OSC 0 / 2 ; title       what the tab is called
 *
 * plus the shell's own OSC 133 marks for a finished command and a fresh
 * prompt, which end whatever the command had set. They are read here rather
 * than beside the rest of the shell integration so that a title the command
 * sets on its way out and the prompt that follows are taken in the order they
 * were written.
 *
 * Claude Code, Codex and a growing list of other tools speak these to any
 * terminal that understands them; the shims turn them on.
 *
 * A pty splits its output wherever it likes, so this walks the stream as a
 * small state machine rather than matching a regex: a sequence routinely
 * straddles two reads, and half of one must neither be lost nor misread. It is
 * also what tells a real bell from the BEL that merely ends an OSC sequence —
 * agents rewrite their title constantly, and treating each terminator as a
 * bell is how the rail once flickered at the rate the title changed.
 */

export type Progress =
  | { state: 'normal'; value: number }
  | { state: 'error'; value?: number }
  | { state: 'paused'; value?: number }
  | { state: 'indeterminate' };

export type Signal =
  | { type: 'bell' }
  | { type: 'notify'; title: string; body: string }
  /** `null` takes the progress away. */
  | { type: 'progress'; progress: Progress | null }
  | { type: 'title'; title: string }
  /** The shell is back: the command that set the things above is over. */
  | { type: 'ended' };

export interface SignalScan {
  mode: 'ground' | 'esc' | 'string' | 'string-esc';
  /** OSC strings are kept; DCS, APC, PM and SOS are skipped to their end. */
  keep: boolean;
  body: string;
  /** kitty notifications arrive in pieces, keyed by their id. */
  kitty: Map<string, { title: string; body: string }>;
}

export const newSignalScan = (): SignalScan => ({
  mode: 'ground',
  keep: false,
  body: '',
  kitty: new Map(),
});

const ESC = '\x1b';
const BEL = '\x07';
/** Nothing worth showing is this long. Past it, the rest is dropped. */
const MAX_BODY = 8192;

/** Every request in this chunk, in order. */
export function scanSignals(chunk: string, state: SignalScan): Signal[] {
  const signals: Signal[] = [];

  for (const char of chunk) {
    switch (state.mode) {
      case 'ground':
        if (char === ESC) state.mode = 'esc';
        else if (char === BEL) signals.push({ type: 'bell' });
        break;

      case 'esc':
        afterEsc(char, state);
        break;

      case 'string':
        if (char === BEL) finish(state, signals);
        else if (char === ESC) state.mode = 'string-esc';
        else if (state.keep && state.body.length < MAX_BODY) state.body += char;
        break;

      case 'string-esc':
        // ESC \ is the string terminator. Any other ESC abandons the string,
        // as a real terminal does, and starts a new sequence.
        if (char === '\\') finish(state, signals);
        else afterEsc(char, state);
        break;
    }
  }

  return signals;
}

/**
 * OSC carries what we want. DCS, APC, PM and SOS are strings too and can hold
 * a BEL that is not a bell, so they are walked and dropped. Everything else is
 * short, ends in a letter, and cannot hide one.
 */
function afterEsc(char: string, state: SignalScan): void {
  if (char === ']' || char === 'P' || char === '_' || char === '^' || char === 'X') {
    state.mode = 'string';
    state.keep = char === ']';
    state.body = '';
  } else {
    state.mode = char === ESC ? 'esc' : 'ground';
  }
}

function finish(state: SignalScan, signals: Signal[]): void {
  state.mode = 'ground';
  if (!state.keep) return;
  const signal = parseOsc(state.body, state);
  state.body = '';
  if (signal) signals.push(signal);
}

/** ConEmu's OSC 9 subcommands. Anything else after `9;` is iTerm2's message. */
const CONEMU = /^(1[0-2]|[1-9])(;|$)/;

function parseOsc(body: string, state: SignalScan): Signal | null {
  const split = body.indexOf(';');
  if (split < 0) return null;
  const code = body.slice(0, split);
  const rest = body.slice(split + 1);

  switch (code) {
    case '0':
    case '2':
      return { type: 'title', title: rest };

    case '9': {
      const conemu = CONEMU.exec(rest);
      if (!conemu) return rest ? { type: 'notify', title: '', body: rest } : null;
      if (conemu[1] !== '4') return null;
      return progress(rest.split(';'));
    }

    case '777': {
      const [kind, title = '', ...body] = rest.split(';');
      if (kind !== 'notify') return null;
      return { type: 'notify', title, body: body.join(';') };
    }

    case '99':
      return kitty(rest, state);

    case '133':
      return rest[0] === 'A' || rest[0] === 'D' ? { type: 'ended' } : null;
  }
  return null;
}

/** `4 ; state ; value`, where a missing or bad value counts as zero. */
function progress([, kind, raw]: string[]): Signal | null {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  const has = raw !== undefined && raw !== '';
  switch (kind) {
    case '0':
      return { type: 'progress', progress: null };
    case '1':
      return { type: 'progress', progress: { state: 'normal', value } };
    case '2':
      return { type: 'progress', progress: { state: 'error', ...(has ? { value } : {}) } };
    case '3':
      return { type: 'progress', progress: { state: 'indeterminate' } };
    case '4':
      return { type: 'progress', progress: { state: 'paused', ...(has ? { value } : {}) } };
  }
  return null;
}

/**
 * kitty's OSC 99: `key=value:key=value ; payload`.
 *
 * A notification can be sent in parts — `d=0` means more is coming — with `p`
 * saying whether the payload is the title or the body, and `e=1` that it is
 * base64. Claude sends exactly that: a title, then a body, then an empty part
 * asking for focus.
 */
function kitty(rest: string, state: SignalScan): Signal | null {
  const split = rest.indexOf(';');
  const meta = split < 0 ? rest : rest.slice(0, split);
  const raw = split < 0 ? '' : rest.slice(split + 1);

  const keys = new Map<string, string>();
  for (const pair of meta.split(':')) {
    const eq = pair.indexOf('=');
    if (eq > 0) keys.set(pair.slice(0, eq), pair.slice(eq + 1));
  }

  const kind = keys.get('p') ?? 'title';
  // Icons, buttons, queries: nothing to show.
  if (kind !== 'title' && kind !== 'body') return null;

  const id = keys.get('i') ?? '';
  const payload = keys.get('e') === '1' ? fromBase64(raw) : raw;
  const part = state.kitty.get(id) ?? { title: '', body: '' };
  part[kind] += payload;

  if (keys.get('d') === '0') {
    state.kitty.set(id, part);
    return null;
  }
  state.kitty.delete(id);
  if (!part.title && !part.body) return null;
  return { type: 'notify', title: part.title, body: part.body };
}

/**
 * Spinner frames, as terminal programs draw them in their titles: braille
 * dots (Codex, and most CLIs through cli-spinners), and the rotating circle
 * and square quarters (Claude Code's `◐ ◑`). A program puts one there only
 * while it is busy and takes it out when it stops — Claude swaps it for `✳`,
 * Codex drops it — which makes the title the one place every agent already
 * says it is working.
 */
const SPINNER = /[⠁-⣿◐◑◒◓◴◵◶◷◰◱◲◳]/;

/**
 * Whether a tab's program says it is working: a spinner in the title it set,
 * or progress it reported. Both are things the program sent on purpose, and
 * both go away when it stops or exits.
 */
export function isWorking(tab: { programTitle?: string; progress?: Progress }): boolean {
  return Boolean(tab.progress) || spins(tab.programTitle);
}

/** Whether a title has a spinner frame in it. */
export function spins(title: string | undefined): boolean {
  return SPINNER.test(title ?? '');
}

function fromBase64(text: string): string {
  try {
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}
