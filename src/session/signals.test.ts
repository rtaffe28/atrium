import { describe, expect, it } from 'vitest';
import { isWorking, newSignalScan, scanSignals, type Signal } from './signals';

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;
const osc = (body: string, end = BEL) => `${ESC}]${body}${end}`;

const scan = (...chunks: string[]): Signal[] => {
  const state = newSignalScan();
  return chunks.flatMap((chunk) => scanSignals(chunk, state));
};

describe('the bell', () => {
  it('rings for a bare BEL', () => {
    expect(scan(`done${BEL}`)).toEqual([{ type: 'bell' }]);
  });

  /**
   * The bug this replaced: agents rewrite their title constantly, every title
   * ends in BEL, and each one read as a ring.
   */
  it('does not ring for the BEL that ends an OSC sequence', () => {
    expect(scan(osc('2;✳ Working'))).toEqual([{ type: 'title', title: '✳ Working' }]);
  });

  it('does not ring for a sequence split across reads', () => {
    expect(scan(`${ESC}]2;half`, ` a title${BEL}`)).toEqual([
      { type: 'title', title: 'half a title' },
    ]);
    expect(scan(ESC, `]2;x${BEL}`)).toEqual([{ type: 'title', title: 'x' }]);
  });

  it('does not ring for a BEL inside a DCS or APC string', () => {
    expect(scan(`${ESC}Ptmux;${BEL}${ST}`, `${ESC}_G${BEL}${ST}`)).toEqual([]);
  });

  it('rings again once the sequence is over', () => {
    expect(scan(`${osc('0;t', ST)}${BEL}`)).toEqual([{ type: 'title', title: 't' }, { type: 'bell' }]);
  });
});

describe('notifications', () => {
  it('reads iTerm2’s OSC 9, which is a body and nothing else', () => {
    expect(scan(osc('9;Codex: turn complete'))).toEqual([
      { type: 'notify', title: '', body: 'Codex: turn complete' },
    ]);
  });

  /** ConEmu took OSC 9 first; its numbered subcommands are not messages. */
  it('does not mistake ConEmu’s subcommands for a message', () => {
    expect(scan(osc('9;9;/Users/ryan'), osc('9;12'))).toEqual([]);
    expect(scan(osc('9;42 tests passed'))).toEqual([
      { type: 'notify', title: '', body: '42 tests passed' },
    ]);
  });

  it('reads OSC 777, which Claude sends when told to use the ghostty channel', () => {
    expect(scan(osc('777;notify;Claude Code;Claude needs your permission'))).toEqual([
      { type: 'notify', title: 'Claude Code', body: 'Claude needs your permission' },
    ]);
  });

  it('keeps a semicolon in a 777 body', () => {
    expect(scan(osc('777;notify;t;a; b'))).toEqual([{ type: 'notify', title: 't', body: 'a; b' }]);
  });

  /** Exactly what Claude writes on its kitty channel: title, body, focus. */
  it('assembles a kitty notification sent in parts', () => {
    expect(
      scan(
        osc('99;i=7:d=0:p=title;Claude Code', ST),
        osc('99;i=7:p=body;Waiting for input', ST),
        osc('99;i=7:d=1:a=focus;', ST),
      ),
    ).toEqual([{ type: 'notify', title: 'Claude Code', body: 'Waiting for input' }]);
  });

  it('decodes a base64 kitty payload', () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('✳ done')));
    expect(scan(osc(`99;e=1:p=body;${encoded}`))).toEqual([
      { type: 'notify', title: '', body: '✳ done' },
    ]);
  });
});

describe('progress', () => {
  it('reads each OSC 9;4 state', () => {
    expect(
      scan(osc('9;4;1;40'), osc('9;4;3;'), osc('9;4;2'), osc('9;4;4;10'), osc('9;4;0;')),
    ).toEqual([
      { type: 'progress', progress: { state: 'normal', value: 40 } },
      { type: 'progress', progress: { state: 'indeterminate' } },
      { type: 'progress', progress: { state: 'error' } },
      { type: 'progress', progress: { state: 'paused', value: 10 } },
      { type: 'progress', progress: null },
    ]);
  });

  it('keeps a value inside 0–100', () => {
    expect(scan(osc('9;4;1;250'))).toEqual([
      { type: 'progress', progress: { state: 'normal', value: 100 } },
    ]);
  });
});

describe('the end of a command', () => {
  it('is read from the shell’s prompt and exit marks', () => {
    expect(scan(osc('133;D;0'), osc('133;A'), osc('133;C'))).toEqual([
      { type: 'ended' },
      { type: 'ended' },
    ]);
  });

  /** A title set on the way out, then the prompt: the prompt has the last word. */
  it('keeps its place in the stream', () => {
    expect(scan(`${osc('2;bye')}${osc('133;D;0')}${osc('2;~/src')}`)).toEqual([
      { type: 'title', title: 'bye' },
      { type: 'ended' },
      { type: 'title', title: '~/src' },
    ]);
  });
});

/**
 * Working is what the program shows, not what Atrium guesses: every agent
 * already animates a spinner in its title while it works and takes it out
 * when it stops. These are the titles Claude Code and Codex actually set.
 */
describe('working', () => {
  it('is a spinner in the title', () => {
    expect(isWorking({ programTitle: '◐ Fix the login bug' })).toBe(true); // Claude
    expect(isWorking({ programTitle: '◑ Fix the login bug' })).toBe(true);
    expect(isWorking({ programTitle: '⠧ probe' })).toBe(true); // Codex
    expect(isWorking({ programTitle: 'renaming... ⠇ | probe' })).toBe(true);
  });

  it('is not the title an idle agent leaves', () => {
    expect(isWorking({ programTitle: '✳ Fix the login bug' })).toBe(false); // Claude
    expect(isWorking({ programTitle: 'Reply with hi | probe' })).toBe(false); // Codex
    expect(isWorking({ programTitle: 'vim README.md' })).toBe(false);
    expect(isWorking({})).toBe(false);
  });

  /** A blank braille cell is a space, not a frame. */
  it('does not count an empty braille cell', () => {
    expect(isWorking({ programTitle: '\u2800 idle' })).toBe(false);
  });

  it('is progress the program reported', () => {
    expect(isWorking({ progress: { state: 'indeterminate' } })).toBe(true);
  });
});
