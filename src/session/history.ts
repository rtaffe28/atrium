/**
 * Make recorded terminal output safe to replay.
 *
 * Scrollback is not inert text. It contains the escape sequences the previous
 * session emitted, and feeding those back into a fresh terminal re-executes
 * them — with two consequences that look like corruption:
 *
 *  - **Queries get answered again.** A Device Attributes query (`ESC[c`) or a
 *    cursor-position report (`ESC[6n`) makes the terminal *reply as input*.
 *    Replayed at a shell prompt, the reply is echoed as literal text — this is
 *    where `^[[?1;2c` comes from.
 *
 *  - **Modes get re-armed.** `ESC[?1004h` turns focus reporting back on, so
 *    the terminal starts sending `ESC[I` / `ESC[O` to a shell that never asked
 *    for them — this is where `^[[O` comes from. `ESC[?1049h` would strand the
 *    view on the alternate screen; `ESC[?2004h`, `ESC[?1000h` do the same for
 *    bracketed paste and mouse reporting.
 *
 * Colours, cursor movement and text are all kept: the point is to restore what
 * the pane *looked* like without re-arming the terminal's state machine. Live
 * output is never passed through this — a running program is entitled to set
 * whatever modes it likes.
 */

/* eslint-disable no-control-regex -- matching ESC and BEL is the entire job here */
const STRIP: RegExp[] = [
  // DEC private mode set/reset: focus reporting, bracketed paste, alt screen,
  // mouse tracking.
  /\x1b\[\?[0-9;]*[hl]/g,
  // Device attributes queries — primary, secondary and tertiary.
  /\x1b\[[>=]?[0-9;]*c/g,
  // Device status / cursor position reports.
  /\x1b\[[0-9;]*n/g,
  // OSC colour queries, which also solicit a reply. Both terminators.
  /\x1b\][0-9;]*;\?(?:\x07|\x1b\\)/g,
];
/* eslint-enable no-control-regex */

export function sanitizeHistory(text: string): string {
  let out = text;
  for (const pattern of STRIP) out = out.replace(pattern, '');
  return out;
}
