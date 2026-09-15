import { describe, expect, it } from 'vitest';
import { sanitizeHistory } from './history';

const ESC = '\x1b';

describe('sanitizing replayed scrollback', () => {
  it('drops device attribute queries, which would be answered again', () => {
    // Replaying this makes xterm send ESC[?1;2c as *input*, which a shell at a
    // prompt echoes as literal text.
    expect(sanitizeHistory(`hello${ESC}[cworld`)).toBe('helloworld');
    expect(sanitizeHistory(`${ESC}[>0cx`)).toBe('x');
  });

  it('drops cursor-position and status reports', () => {
    expect(sanitizeHistory(`a${ESC}[6nb`)).toBe('ab');
    expect(sanitizeHistory(`a${ESC}[5nb`)).toBe('ab');
  });

  it('drops mode changes that would re-arm the terminal', () => {
    // Focus reporting: the source of stray ^[[O at a shell prompt.
    expect(sanitizeHistory(`${ESC}[?1004hx${ESC}[?1004l`)).toBe('x');
    // Bracketed paste, alt screen, mouse tracking.
    expect(sanitizeHistory(`${ESC}[?2004hx`)).toBe('x');
    expect(sanitizeHistory(`${ESC}[?1049hx${ESC}[?1049l`)).toBe('x');
    expect(sanitizeHistory(`${ESC}[?1000hx`)).toBe('x');
  });

  it('drops OSC colour queries with either terminator', () => {
    expect(sanitizeHistory(`${ESC}]10;?\x07x`)).toBe('x');
    expect(sanitizeHistory(`${ESC}]11;?${ESC}\\x`)).toBe('x');
  });

  /** The whole point is that the pane still looks like it did. */
  it('keeps colour, cursor movement and text intact', () => {
    const painted = `${ESC}[32mgreen${ESC}[0m ${ESC}[1mbold${ESC}[0m\r\n${ESC}[2K${ESC}[Hdone`;
    expect(sanitizeHistory(painted)).toBe(painted);
  });

  it('leaves ordinary output untouched', () => {
    expect(sanitizeHistory('~/git/atrium % npm test\r\n')).toBe('~/git/atrium % npm test\r\n');
  });
});
