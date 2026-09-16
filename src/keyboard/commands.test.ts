import { describe, expect, it } from 'vitest';
import { COMMANDS, display, matches } from './commands';

const press = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

describe('keyboard bindings', () => {
  it('treats Mod as the platform command key', () => {
    expect(matches(press({ key: 'n', metaKey: true }), 'Mod+N')).toBe(true);
    expect(matches(press({ key: 'n', ctrlKey: true }), 'Mod+N')).toBe(true);
    expect(matches(press({ key: 'n' }), 'Mod+N')).toBe(false);
  });

  it('does not fire when extra modifiers are held', () => {
    expect(matches(press({ key: 'n', metaKey: true, shiftKey: true }), 'Mod+N')).toBe(false);
    expect(matches(press({ key: 'n', metaKey: true, shiftKey: true }), 'Mod+Shift+N')).toBe(true);
  });

  it('matches punctuation keys', () => {
    expect(matches(press({ key: ',', metaKey: true }), 'Mod+,')).toBe(true);
  });

  it('writes bindings the way each platform does', () => {
    expect(display('Mod+N', 'mac')).toBe('⌘N');
    expect(display('Mod+N', 'win')).toBe('Ctrl+N');
    expect(display('Mod+Shift+T', 'mac')).toBe('⌘⇧T');
  });

  /** The settings list and the handler must not be able to disagree. */
  it('defines every command exactly once', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = COMMANDS.map((c) => c.keys);
    expect(new Set(keys).size, 'no two commands share a binding').toBe(keys.length);
  });
});
