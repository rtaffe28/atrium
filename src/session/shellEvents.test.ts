import { describe, expect, it } from 'vitest';
import { newShellEventScan, scanShellEvents } from './shellEvents';

const ESC = '\x1b';
const BEL = '\x07';
const osc = (body: string) => `${ESC}]${body}${BEL}`;

describe('reading shell integration events', () => {
  it('reports the command line verbatim, rather than us reassembling it', () => {
    expect(scanShellEvents(osc('633;E;claude --resume abc'), newShellEventScan())).toEqual([
      { type: 'started', command: 'claude --resume abc' },
    ]);
  });

  it('reports when a command finished, and how', () => {
    expect(scanShellEvents(osc('133;D;0'), newShellEventScan())).toEqual([
      { type: 'finished', exitCode: 0 },
    ]);
    expect(scanShellEvents(osc('133;D;127'), newShellEventScan())).toEqual([
      { type: 'finished', exitCode: 127 },
    ]);
  });

  it('reports a prompt, which is how a tab knows it is idle', () => {
    expect(scanShellEvents(osc('133;A'), newShellEventScan())).toEqual([{ type: 'prompt' }]);
  });

  it('reports where the shell is, so a new session can start there', () => {
    expect(scanShellEvents(osc('633;P;Cwd=/Users/ryan/git/atrium'), newShellEventScan())).toEqual([
      { type: 'cwd', cwd: '/Users/ryan/git/atrium' },
    ]);
  });

  it('keeps a path containing semicolons intact, and ignores other properties', () => {
    expect(scanShellEvents(osc('633;P;Cwd=/tmp/a;b'), newShellEventScan())).toEqual([
      { type: 'cwd', cwd: '/tmp/a;b' },
    ]);
    expect(scanShellEvents(osc('633;P;IsWindows=False'), newShellEventScan())).toEqual([]);
  });

  it('keeps a command line containing semicolons intact', () => {
    expect(scanShellEvents(osc('633;E;a; b; c'), newShellEventScan())).toEqual([
      { type: 'started', command: 'a; b; c' },
    ]);
  });

  it('decodes escaped bytes, since a command line may contain anything', () => {
    expect(scanShellEvents(osc('633;E;echo \\x0ahi'), newShellEventScan())).toEqual([
      { type: 'started', command: 'echo \nhi' },
    ]);
  });

  /** A pty splits wherever it likes; half a sequence must not be an event. */
  it('carries an unterminated sequence across chunks', () => {
    const state = newShellEventScan();
    expect(scanShellEvents(`${ESC}]633;E;clau`, state)).toEqual([]);
    expect(scanShellEvents(`de --model opus${BEL}`, state)).toEqual([
      { type: 'started', command: 'claude --model opus' },
    ]);
  });

  it('accepts the two-byte string terminator as well as BEL', () => {
    expect(scanShellEvents(`${ESC}]133;D;1${ESC}\\`, newShellEventScan())).toEqual([
      { type: 'finished', exitCode: 1 },
    ]);
  });

  it('finds several events in one chunk, in order', () => {
    const chunk = osc('133;D;0') + 'output' + osc('133;A') + osc('633;E;ls');
    expect(scanShellEvents(chunk, newShellEventScan())).toEqual([
      { type: 'finished', exitCode: 0 },
      { type: 'prompt' },
      { type: 'started', command: 'ls' },
    ]);
  });

  it('ignores ordinary output and unrelated sequences', () => {
    const state = newShellEventScan();
    expect(scanShellEvents(`${ESC}[32mgreen${ESC}[0m plain text`, state)).toEqual([]);
    expect(scanShellEvents(osc('0;a window title'), state)).toEqual([]);
  });

  it('does not grow without bound on a stream that never terminates', () => {
    const state = newShellEventScan();
    scanShellEvents(`${ESC}]633;E;` + 'x'.repeat(9000), state);
    expect(state.pending.length).toBeLessThanOrEqual(4096);
  });
});
