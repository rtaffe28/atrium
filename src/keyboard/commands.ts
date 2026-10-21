import type { Platform } from '../host/types';

/**
 * Every keyboard shortcut, in one list.
 *
 * Both the handler and the settings list read from here. A shortcut defined in
 * a component and then described again in a settings panel is two things that
 * drift; describing it once means the list a user reads is the list that runs.
 *
 * `Mod` is the platform's command key — ⌘ on macOS, Ctrl elsewhere — so a
 * binding is written once and honours the convention on each.
 */
export type CommandId =
  | 'session.new'
  | 'session.rename'
  | 'tab.newTerminal'
  | 'tab.close'
  | 'file.open'
  | 'folder.open'
  | 'settings.open';

export interface Command {
  id: CommandId;
  label: string;
  /** Modifiers then key, e.g. `Mod+Shift+N`. */
  keys: string;
  /** Grouping in settings. */
  group: 'Sessions' | 'Tabs' | 'Application';
}

export const COMMANDS: Command[] = [
  { id: 'session.new', label: 'New session', keys: 'Mod+N', group: 'Sessions' },
  // Shifted so that on Windows and Linux it is not Ctrl+R, the shell's own
  // history search — see the rule in docs/plan/active/10-keyboard.md.
  { id: 'session.rename', label: 'Rename session', keys: 'Mod+Shift+R', group: 'Sessions' },
  { id: 'tab.newTerminal', label: 'New terminal tab', keys: 'Mod+T', group: 'Tabs' },
  { id: 'tab.close', label: 'Close tab', keys: 'Mod+W', group: 'Tabs' },
  { id: 'file.open', label: 'Open…', keys: 'Mod+O', group: 'Tabs' },
  { id: 'folder.open', label: 'Open folder…', keys: 'Mod+Shift+O', group: 'Tabs' },
  { id: 'settings.open', label: 'Settings', keys: 'Mod+,', group: 'Application' },
];

/** Does this event fire this binding? */
export function matches(event: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const wants = (name: string) => parts.some((p) => p.toLowerCase() === name);

  // Coerced, because an event may simply not carry a modifier property and
  // `false !== undefined` would fail every binding.
  const mod = Boolean(event.metaKey) || Boolean(event.ctrlKey);
  if (wants('mod') !== mod) return false;
  if (wants('shift') !== Boolean(event.shiftKey)) return false;
  if (wants('alt') !== Boolean(event.altKey)) return false;
  return event.key.toLowerCase() === key;
}

/** How the binding should be written for this platform. */
export function display(keys: string, platform: Platform): string {
  return keys
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl';
      if (lower === 'shift') return platform === 'mac' ? '⇧' : 'Shift';
      if (lower === 'alt') return platform === 'mac' ? '⌥' : 'Alt';
      return part.toUpperCase();
    })
    .join(platform === 'mac' ? '' : '+');
}
