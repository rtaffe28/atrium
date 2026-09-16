import { describe, expect, it } from 'vitest';
import { newBellScan, scanForBell } from './bell';

const ESC = '\x1b';
const BEL = '\x07';

describe('telling a bell from an OSC terminator', () => {
  it('hears a bare bell', () => {
    expect(scanForBell(`done${BEL}`, newBellScan())).toBe(true);
  });

  /**
   * The flicker: agents rewrite their window title constantly to show
   * progress, and every one of those ends in BEL.
   */
  it('ignores the BEL that ends a window-title sequence', () => {
    expect(scanForBell(`${ESC}]0;claude — thinking${BEL}`, newBellScan())).toBe(false);
    expect(scanForBell(`${ESC}]2;atrium${BEL}output`, newBellScan())).toBe(false);
  });

  it('ignores an OSC that ends with the two-byte string terminator instead', () => {
    expect(scanForBell(`${ESC}]0;title${ESC}\\`, newBellScan())).toBe(false);
  });

  /** A pty hands over arbitrary chunks; sequences are routinely split. */
  it('carries OSC state across a chunk boundary', () => {
    const state = newBellScan();
    expect(scanForBell(`${ESC}]0;half a ti`, state)).toBe(false);
    expect(scanForBell(`tle${BEL}`, state)).toBe(false);
    expect(state.inOsc).toBe(false);
  });

  it('still hears a bell that follows a title sequence', () => {
    expect(scanForBell(`${ESC}]0;title${BEL}now ring${BEL}`, newBellScan())).toBe(true);
  });

  it('is not fooled by ordinary escape sequences', () => {
    expect(scanForBell(`${ESC}[32mgreen${ESC}[0m`, newBellScan())).toBe(false);
    expect(scanForBell(`${ESC}[?2004h`, newBellScan())).toBe(false);
  });

  it('hears a bell split from its own chunk', () => {
    const state = newBellScan();
    expect(scanForBell(`${ESC}`, state)).toBe(false);
    expect(scanForBell(`[0m`, state)).toBe(false);
    expect(scanForBell(BEL, state)).toBe(true);
  });
});
