import { describe, expect, it } from 'vitest';
import { MockDriver } from './mock';

const titles = (driver: MockDriver) => driver.list().map((s) => s.title);

describe('the order of the rail', () => {
  it('starts newest first', () => {
    expect(titles(new MockDriver())).toEqual([
      'Production build',
      'Auth flow migration',
      'Session rail + status dots',
      'WebGL renderer spike',
    ]);
  });

  it('puts a new session at the top', () => {
    const driver = new MockDriver();
    driver.createSession({ title: 'Fresh', cwd: '~', branch: 'main' });
    expect(titles(driver)[0]).toBe('Fresh');
  });

  it('puts a session where it is moved to, counted among the others', () => {
    const driver = new MockDriver();
    const [first, , third] = driver.list();

    driver.moveSession(first.id, 2);
    expect(titles(driver)).toEqual([
      'Auth flow migration',
      'Session rail + status dots',
      'Production build',
      'WebGL renderer spike',
    ]);

    driver.moveSession(third.id, 0);
    expect(titles(driver)[0]).toBe('Session rail + status dots');
  });

  it('puts a session moved past the end last, and leaves one it does not have', () => {
    const driver = new MockDriver();
    const [first] = driver.list();
    driver.moveSession(first.id, 99);
    expect(titles(driver).at(-1)).toBe('Production build');

    const before = titles(driver);
    driver.moveSession('nope', 0);
    expect(titles(driver)).toEqual(before);
  });

  it('keeps the order across a restore', () => {
    const original = new MockDriver();
    original.moveSession(original.list()[0].id, 3);

    const restored = new MockDriver();
    for (const s of restored.list()) restored.killSession(s.id);
    restored.hydrate(original.snapshot(), {});

    expect(titles(restored)).toEqual(titles(original));
  });

  it('puts a tab pulled out onto the rail at the top, as a new session', () => {
    const driver = new MockDriver();
    const session = driver.list().find((s) => Object.keys(s.tabs).length === 2)!;
    const groupId = Object.keys(session.groups)[0];
    const tabId = session.groups[groupId].tabIds[1];

    driver.moveTab(session.id, tabId, { kind: 'rail' });

    expect(driver.list()[0].tabs[tabId]).toBeDefined();
  });
});
