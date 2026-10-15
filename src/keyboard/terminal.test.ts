import { describe, expect, it } from 'vitest';
import { encodeKey } from './terminal';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('encodeKey', () => {
  it('sends ESC CR for Shift+Enter, which agents read as a newline', () => {
    expect(encodeKey(key({ key: 'Enter', shiftKey: true }))).toBe('\x1b\r');
  });

  it('leaves plain Enter to xterm, so it still submits', () => {
    expect(encodeKey(key({ key: 'Enter' }))).toBeNull();
  });

  it('leaves Enter with any other modifier to xterm', () => {
    expect(encodeKey(key({ key: 'Enter', altKey: true }))).toBeNull();
    expect(encodeKey(key({ key: 'Enter', ctrlKey: true }))).toBeNull();
    expect(encodeKey(key({ key: 'Enter', metaKey: true }))).toBeNull();
    expect(encodeKey(key({ key: 'Enter', shiftKey: true, altKey: true }))).toBeNull();
  });

  it('leaves every other key to xterm, Escape above all', () => {
    expect(encodeKey(key({ key: 'Escape' }))).toBeNull();
    expect(encodeKey(key({ key: 'Escape', shiftKey: true }))).toBeNull();
    expect(encodeKey(key({ key: 'A', shiftKey: true }))).toBeNull();
    expect(encodeKey(key({ key: 'c', ctrlKey: true }))).toBeNull();
  });
});
