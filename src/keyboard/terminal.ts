/**
 * Keys the terminal would otherwise send indistinguishably.
 *
 * xterm.js encodes Shift+Enter as a bare carriage return — the same byte as
 * Enter — so a program that means Shift+Enter as "new line, not submit" never
 * hears the difference. Claude Code's own `/terminal-setup` resolves this in
 * VS Code, Zed and Alacritty by binding Shift+Enter to ESC CR, the sequence a
 * terminal with Option-as-Meta sends for Option+Enter, and the sequence the
 * same xterm already sends here for Alt+Enter. Sending it for Shift+Enter is
 * what those terminals do after setup, without the setup.
 *
 * Returns the bytes to send instead of letting xterm encode the key, or null
 * to let xterm encode it as it normally would. Everything else — Escape above
 * all — stays with xterm; see the rule in docs/plan/active/10-keyboard.md.
 */
export function encodeKey(event: KeyboardEvent): string | null {
  // Enter mid-composition confirms the IME's text; it is not a key for the
  // pty, and xterm knows how to let the composition finish.
  if (event.isComposing) return null;
  if (
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    return '\x1b\r';
  }
  return null;
}
