import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { MockHost } from '../host/mock';
import { SAMPLE_ROOT } from '../host/mock/files';

const README = `${SAMPLE_ROOT}/README.md`;

/** The mock session the tests work in. */
function openRailSession() {
  const row = screen.getByText('Session rail + status dots').closest('.session-row')!;
  act(() => {
    fireEvent.click(row);
  });
  return row;
}

const tabTitles = () =>
  [...document.querySelectorAll('[data-tab-id] .tab-title')].map((el) => el.textContent ?? '');

const showChanges = () =>
  act(() => {
    fireEvent.keyDown(window, { key: 'g', ctrlKey: true, shiftKey: true });
  });

const changeRow = (suffix: string) =>
  waitFor(() => {
    const el = screen.getByRole('listbox', { name: 'Changed files' }).querySelector(`[data-path$="${suffix}"]`);
    expect(el, `a row for ${suffix}`).not.toBeNull();
    return el as HTMLElement;
  });

/** A host whose README has had its first line rewritten and a line added. */
async function hostWithEdit(): Promise<MockHost> {
  const host = new MockHost();
  const before = await host.files.read(README);
  if (before.kind !== 'text') throw new Error('the sample README should be text');
  const lines = before.text.split('\n');
  lines[0] = '# atrium, reviewed';
  lines.splice(4, 0, 'A line the agent added.');
  host.files.write(README, lines.join('\n'));
  return host;
}

describe('a changes tab', () => {
  afterEach(cleanup);

  it('lists what changed against HEAD and shows the first change as a diff', async () => {
    const host = await hostWithEdit();
    render(<App host={host} />);
    openRailSession();
    showChanges();

    await waitFor(() => expect(tabTitles()).toContain('Changes'));
    const row = await changeRow('/README.md');
    expect(row.textContent).toContain('+2');
    expect(row.textContent).toContain('−1');

    expect(await screen.findByText('A line the agent added.')).toBeTruthy();
    const added = screen.getByText('# atrium, reviewed').closest('.diff-line')!;
    expect(added.className).toContain('is-added');
    const removed = screen.getByText('# atrium').closest('.diff-line')!;
    expect(removed.className).toContain('is-removed');
  });

  it('folds unchanged lines away until a fold is opened', async () => {
    const host = new MockHost();
    const before = await host.files.read(README);
    if (before.kind !== 'text') throw new Error('text');
    host.files.write(README, `${before.text}\nThe end, rewritten.\n`);
    render(<App host={host} />);
    openRailSession();
    showChanges();

    const fold = await screen.findByRole('button', { name: /unchanged lines/ });
    expect(screen.queryByText('# atrium')).toBeNull();
    act(() => {
      fireEvent.click(fold);
    });
    expect(await screen.findByText('# atrium')).toBeTruthy();
  });

  it('follows the agent: a new file appears in the list when it is written', async () => {
    const host = await hostWithEdit();
    render(<App host={host} />);
    openRailSession();
    showChanges();
    await changeRow('/README.md');

    act(() => host.files.write(`${SAMPLE_ROOT}/docs/review.md`, '# Review\n'));
    // The next poll, or coming back to the window, asks again.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    const row = await changeRow('/docs/review.md');
    expect(row.querySelector('.change-letter')?.textContent).toBe('U');

    act(() => {
      fireEvent.click(row);
    });
    expect(await screen.findByText('# Review')).toBeTruthy();
  });

  it('opens the file at a line from the diff', async () => {
    const host = await hostWithEdit();
    render(<App host={host} />);
    openRailSession();
    showChanges();

    const line = await screen.findByRole('button', { name: '5' });
    act(() => {
      fireEvent.click(line);
    });
    await waitFor(() => expect(tabTitles()).toContain('README.md'));
  });

  it('opens from the rail\'s +/−', async () => {
    const host = await hostWithEdit();
    render(<App host={host} />);
    const row = openRailSession();
    const session = host.sessions.list().find((s) => s.title === 'Session rail + status dots')!;
    act(() => host.sessions.setDiffStat(session.id, { files: 1, added: 2, removed: 1 }));

    const stat = row.querySelector<HTMLElement>('.session-diff')!;
    expect(stat.textContent).toContain('+2');
    act(() => {
      fireEvent.click(stat);
    });
    await waitFor(() => expect(tabTitles()).toContain('Changes'));
  });

  it('degrades on a host that cannot ask git', async () => {
    const base = new MockHost();
    const host = { ...base, name: 'test', capabilities: { ...base.capabilities, git: false } };
    render(<App host={host} />);
    openRailSession();
    const session = base.sessions.list().find((s) => s.title === 'Session rail + status dots')!;
    const groupId = Object.keys(session.groups)[0];
    act(() => base.sessions.openChangesIn(session.id, groupId, SAMPLE_ROOT));
    expect(await screen.findByText(/cannot ask git/)).toBeTruthy();
  });
});
