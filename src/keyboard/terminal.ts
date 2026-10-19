/**
 * What xterm would otherwise send indistinguishably, or not at all.
 *
 * Keys first. encodePaste(), below, is the same question for the clipboard.
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


/**
 * What to send for a paste xterm would drop.
 *
 * xterm pastes the clipboard's text and nothing else, so pasting an image on
 * its own — a screenshot, which has no text beside it — did nothing, with no
 * sign that anything had been tried. Claude Code takes images from the
 * clipboard itself: Ctrl+V is its image-paste key everywhere but Windows,
 * and on being sent that byte it reads the clipboard and attaches what it
 * finds. So an image with no text to paste becomes that byte, and Cmd+V on a
 * screenshot does what Ctrl+V would have. In a shell the same byte is
 * quoted-insert, which waits for a key and is harmless; the image was going
 * nowhere there either.
 *
 * Returns the bytes to send, or null to let xterm paste the text as it
 * always has — which it does whenever there is text, image or not.
 */
export function encodePaste(data: DataTransfer | null): string | null {
  if (!data || data.getData('text/plain')) return null;
  const image = Array.from(data.items, (item) => item.type).some((type) =>
    type.startsWith('image/'),
  );
  return image ? '\x16' : null;
}
