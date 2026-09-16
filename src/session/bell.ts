/**
 * Tell a real terminal bell from the byte that merely ends an OSC sequence.
 *
 * A bare BEL (0x07) is an agent asking for the human. But BEL is *also* a
 * legal terminator for an OSC sequence — `ESC ] 0 ; some title BEL` is how a
 * program sets the window title, and coding agents rewrite their title
 * constantly to show progress. Treating every BEL as a bell made the rail
 * flicker between "Working" and "Needs you" at exactly the rate the title
 * changed.
 *
 * So this walks the stream as a tiny state machine. It has to be a machine
 * rather than a regex because a pty hands over arbitrary chunks: an OSC
 * sequence is routinely split across two reads, and half a sequence must not
 * read as a bell.
 */

export interface BellScan {
  /** Mid-OSC, waiting for its terminator. */
  inOsc: boolean;
  /** Saw an ESC that might begin a sequence. */
  afterEsc: boolean;
}

export const newBellScan = (): BellScan => ({ inOsc: false, afterEsc: false });

const ESC = '\x1b';
const BEL = '\x07';

/** Does this chunk contain a bell the human is meant to hear? */
export function scanForBell(chunk: string, state: BellScan): boolean {
  let rang = false;

  for (const char of chunk) {
    if (state.inOsc) {
      // OSC ends at BEL, or at ESC \ (the two-byte string terminator).
      if (char === BEL) {
        state.inOsc = false;
      } else if (state.afterEsc) {
        state.afterEsc = false;
        if (char === '\\') state.inOsc = false;
      } else if (char === ESC) {
        state.afterEsc = true;
      }
      continue;
    }

    if (state.afterEsc) {
      state.afterEsc = false;
      // Only OSC swallows a BEL. Every other escape sequence is short and
      // terminated by a letter, so it cannot hide one.
      if (char === ']') state.inOsc = true;
      continue;
    }

    if (char === ESC) {
      state.afterEsc = true;
    } else if (char === BEL) {
      rang = true;
    }
  }

  return rang;
}
