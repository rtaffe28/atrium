import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyOpen, parseRequest, RequestWatcher, type AgentRequest } from './requests';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrium-requests-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseRequest', () => {
  it('takes the verb from the first line and the rest as written', () => {
    expect(parseRequest('open\n/a/b c.md\n')).toEqual({ verb: 'open', args: ['/a/b c.md'] });
    expect(parseRequest('report\nsummary\nmigrating auth\n')).toEqual({
      verb: 'report',
      args: ['summary', 'migrating auth'],
    });
    expect(parseRequest('\n')).toBeNull();
    expect(parseRequest('')).toBeNull();
  });
});

describe('classifyOpen', () => {
  it('passes an http(s) URL through and refuses other schemes', async () => {
    expect(await classifyOpen('http://localhost:5173/', '/home')).toEqual({
      request: { verb: 'open', url: 'http://localhost:5173/' },
    });
    expect(await classifyOpen('ftp://x/y', '/home')).toMatchObject({ refused: expect.stringContaining('only http') });
  });

  it('tells a file from a folder, and takes a :line', async () => {
    writeFileSync(join(dir, 'a.ts'), '');
    mkdirSync(join(dir, 'docs'));
    expect(await classifyOpen(join(dir, 'a.ts'), '/home')).toEqual({
      request: { verb: 'open', target: { kind: 'file', path: join(dir, 'a.ts') } },
    });
    expect(await classifyOpen(`${join(dir, 'a.ts')}:12:3`, '/home')).toEqual({
      request: { verb: 'open', target: { kind: 'file', path: join(dir, 'a.ts'), line: 12 } },
    });
    expect(await classifyOpen(join(dir, 'docs'), '/home')).toEqual({
      request: { verb: 'open', target: { kind: 'folder', root: join(dir, 'docs') } },
    });
  });

  it('expands ~ against the home it is given', async () => {
    writeFileSync(join(dir, 'notes.md'), '');
    expect(await classifyOpen('~/notes.md', dir)).toEqual({
      request: { verb: 'open', target: { kind: 'file', path: join(dir, 'notes.md') } },
    });
  });

  it('refuses what is not there', async () => {
    expect(await classifyOpen(join(dir, 'missing.md'), '/home')).toMatchObject({
      refused: expect.stringContaining('no such file'),
    });
    expect(await classifyOpen('   ', '/home')).toMatchObject({ refused: 'nothing to open' });
  });
});

describe('RequestWatcher', () => {
  const WAIT = { timeout: 4000, interval: 25 };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 250));

  function tab(name: string): string {
    const requests = join(dir, name, 'requests');
    mkdirSync(requests, { recursive: true });
    return requests;
  }

  it('acts on a request as it is written, and removes it', async () => {
    const file = join(dir, 'PLAN.md');
    writeFileSync(file, '# plan');
    const requests = tab('t1');
    const seen: Array<[string, AgentRequest]> = [];
    const watcher = new RequestWatcher(dir, '/home', (tabId, request) => seen.push([tabId, request]));
    await watcher.start();
    try {
      await settled();
      writeFileSync(join(requests, '.1-1-1'), `open\n${file}\n`);
      writeFileSync(join(requests, '1-1-1'), `open\n${file}\n`);
      await vi.waitFor(
        () => expect(seen).toEqual([['t1', { verb: 'open', target: { kind: 'file', path: file } }]]),
        WAIT,
      );
      await vi.waitFor(() => expect(existsSync(join(requests, '1-1-1'))).toBe(false), WAIT);
    } finally {
      watcher.close();
    }
  });

  /** Four in a row, as `a && b && c; d` on one command line produces. */
  it('handles a burst of requests, in order, and none twice', async () => {
    const requests = tab('t5');
    const seen: string[] = [];
    const watcher = new RequestWatcher(dir, '/home', (_tab, request) => seen.push('url' in request ? request.url : ''));
    await watcher.start();
    try {
      await settled();
      for (const n of [1, 2, 3, 4]) {
        writeFileSync(join(requests, `.1-1-${n}`), `open\nhttp://localhost:${n}/\n`);
        renameSync(join(requests, `.1-1-${n}`), join(requests, `1-1-${n}`));
      }
      await vi.waitFor(() => expect(seen).toHaveLength(4), WAIT);
      expect(seen).toEqual([1, 2, 3, 4].map((n) => `http://localhost:${n}/`));
      await vi.waitFor(() => expect(readdirSync(requests)).toEqual([]), WAIT);
    } finally {
      watcher.close();
    }
  });

  it('sweeps up what was written before it started', async () => {
    const requests = tab('t2');
    writeFileSync(join(requests, '1-1-1'), 'open\nhttp://localhost:5173/\n');
    const seen: Array<[string, AgentRequest]> = [];
    const watcher = new RequestWatcher(dir, '/home', (tabId, request) => seen.push([tabId, request]));
    await watcher.start();
    watcher.close();
    expect(seen).toEqual([['t2', { verb: 'open', url: 'http://localhost:5173/' }]]);
    expect(existsSync(join(requests, '1-1-1'))).toBe(false);
  });

  it('declines what is not there, and says so in the tab’s log', async () => {
    const requests = tab('t3');
    writeFileSync(join(requests, '1-1-1'), `open\n${join(dir, 'nothing.md')}\n`);
    writeFileSync(join(requests, '1-1-2'), 'dance\n');
    const seen: unknown[] = [];
    const watcher = new RequestWatcher(dir, '/home', (...args) => seen.push(args));
    await watcher.start();
    watcher.close();
    expect(seen).toEqual([]);
    const log = readFileSync(join(dir, 't3', 'log'), 'utf8');
    expect(log).toContain('open refused: no such file');
    expect(log).toContain('unknown request: dance');
  });

  it('keeps a report as JSON that main wrote', async () => {
    const requests = tab('t4');
    writeFileSync(join(requests, '1-1-1'), 'report\nsummary\nmigrating auth\n');
    writeFileSync(join(requests, '1-1-2'), 'report\npr\n412\n');
    const watcher = new RequestWatcher(dir, '/home', () => {});
    await watcher.start();
    watcher.close();
    expect(JSON.parse(readFileSync(join(dir, 't4', 'meta.json'), 'utf8'))).toEqual({
      summary: 'migrating auth',
      pr: '412',
    });
  });
});
