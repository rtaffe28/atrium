import { describe, expect, it } from 'vitest';
import { encodeDrop, encodeKey, encodePaste } from './terminal';

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


describe('encodePaste', () => {
  /** What the browser hands a paste handler, reduced to what is read. */
  const clipboard = (text: string, types: string[]) =>
    ({
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: types.map((type) => ({ type })),
    }) as unknown as DataTransfer;

  it('sends Ctrl+V for an image with no text, which xterm would drop', () => {
    expect(encodePaste(clipboard('', ['image/png']))).toBe('\x16');
    expect(encodePaste(clipboard('', ['text/html', 'image/jpeg']))).toBe('\x16');
  });

  it('leaves text to xterm, image or not', () => {
    expect(encodePaste(clipboard('ls -la', ['text/plain']))).toBeNull();
    expect(encodePaste(clipboard('shot.png', ['text/plain', 'image/png']))).toBeNull();
  });

  it('leaves an empty paste alone', () => {
    expect(encodePaste(clipboard('', []))).toBeNull();
    expect(encodePaste(clipboard('', ['text/html']))).toBeNull();
    expect(encodePaste(null)).toBeNull();
  });
});

describe('encodeDrop', () => {
  it('types a dropped path followed by a space', () => {
    expect(encodeDrop(['/Users/ryan/shot.png'])).toBe('/Users/ryan/shot.png ');
  });

  it('escapes what a shell would read as more than a character', () => {
    expect(encodeDrop(['/Users/ryan/Screen Shot (1).png'])).toBe(
      '/Users/ryan/Screen\\ Shot\\ \\(1\\).png ',
    );
    expect(encodeDrop(["/tmp/it's $HOME & more;.txt"])).toBe(
      "/tmp/it\\'s\\ \\$HOME\\ \\&\\ more\\;.txt ",
    );
  });

  it('leaves letters in any script alone', () => {
    expect(encodeDrop(['/Users/ryan/écran 日本.png'])).toBe('/Users/ryan/écran\\ 日本.png ');
  });

  it('types several files one after another', () => {
    expect(encodeDrop(['/a/one.png', '/a/two.png'])).toBe('/a/one.png /a/two.png ');
  });

  it('has nothing to type for a drop with no paths', () => {
    expect(encodeDrop([])).toBeNull();
  });
});
