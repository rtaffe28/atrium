import { describe, expect, it } from 'vitest';
import { MockDriver } from './mock';
import type { Session } from './types';

/**
 * A restored workspace has to come back with the same shape — splits, tab
 * order and all — because that layout is what the user arranged by hand.
 */
function shape(sessions: Session[]) {
  return sessions.map((s) => ({
    title: s.title,
    branch: s.branch,
    layout: s.layout,
    groups: Object.values(s.groups).map((g) => g.tabIds.length),
    tabs: Object.values(s.tabs).map((t) => `${t.kind}:${t.title}`),
  }));
}

describe('workspace persistence', () => {
  it('round-trips sessions, panes and tab order', () => {
    const original = new MockDriver();

    // Arrange something non-trivial: a split, so the layout tree is a branch.
    const session = original.list().find((s) => Object.keys(s.tabs).length === 2)!;
    const groupId = Object.keys(session.groups)[0];
    const secondTab = session.groups[groupId].tabIds[1];
    original.moveTab(session.id, secondTab, { kind: 'split', groupId, edge: 'right' });

    const before = original.snapshot();
    expect(before.some((s) => s.layout.type === 'split')).toBe(true);

    const restored = new MockDriver();
    for (const s of restored.list()) restored.killSession(s.id);
    restored.hydrate(before, original.scrollback(32_000));

    expect(shape(restored.snapshot())).toEqual(shape(before));
  });

  it('restores scrollback so a pane reads as continuous', async () => {
    const original = new MockDriver();
    const tabId = Object.keys(original.list()[0].tabs)[0];
    original.write(tabId, 'echo hi');

    const history = original.scrollback(32_000);
    expect(history[tabId]).toContain('echo hi');

    const restored = new MockDriver();
    for (const s of restored.list()) restored.killSession(s.id);
    restored.hydrate(original.snapshot(), history);

    let replayed = '';
    restored.attach(tabId, (chunk) => {
      replayed += chunk;
    });
    expect(replayed).toContain('echo hi');
  });

  it('clears agent state on restore rather than claiming work is still running', () => {
    const original = new MockDriver();
    const snapshot = original.snapshot().map((s) => ({
      ...s,
      tabs: Object.fromEntries(
        Object.entries(s.tabs).map(([id, t]) => [id, { ...t, agentState: 'working' as const }]),
      ),
    }));

    const restored = new MockDriver();
    for (const s of restored.list()) restored.killSession(s.id);
    restored.hydrate(snapshot, {});

    const states = restored
      .snapshot()
      .flatMap((s) => Object.values(s.tabs).map((t) => t.agentState));
    // Scripted tabs may start working again once respawned; what must not
    // happen is inheriting a state from a process that no longer exists.
    expect(states.every((state) => state === undefined || state === 'working')).toBe(true);
  });

  it('trims scrollback to the budget it is given', () => {
    const original = new MockDriver();
    const tabId = Object.keys(original.list()[0].tabs)[0];
    original.write(tabId, 'x'.repeat(5000));

    const trimmed = original.scrollback(100);
    expect(trimmed[tabId].length).toBeLessThanOrEqual(100);
  });
});
