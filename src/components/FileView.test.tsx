import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { MockHost } from '../host/mock';
import { SAMPLE_ROOT } from '../host/mock/files';

/** The mock session with a file open beside its agent. */
function openRailSession() {
  const row = screen.getByText('Session rail + status dots').closest('.session-row')!;
  act(() => {
    fireEvent.click(row);
  });
}

const tabTitles = () =>
  [...document.querySelectorAll('[data-tab-id] .tab-title')].map((el) => el.textContent ?? '');

const treeRow = (suffix: string) =>
  waitFor(() => {
    const el = screen.getByRole('tree').querySelector(`[data-path$="${suffix}"]`);
    expect(el, `a tree row for ${suffix}`).not.toBeNull();
    return el as HTMLElement;
  });

describe('a file tab', () => {
  afterEach(cleanup);

  it('shows the file beside the agent editing it, found in the repository tree', async () => {
    render(<App host={new MockHost()} />);
    openRailSession();

    expect(await screen.findByText(/Also a drop target/)).toBeTruthy();
    expect(tabTitles()).toContain('Sidebar.tsx');

    const row = await treeRow('/src/components/Sidebar.tsx');
    expect(row.className).toContain('is-selected');
    expect(screen.queryByText('node_modules')).toBeNull();
    expect(screen.getByText('docs')).toBeTruthy();
  });

  it('follows the file as the agent rewrites it', async () => {
    const host = new MockHost();
    render(<App host={host} />);
    openRailSession();
    await screen.findByText(/Also a drop target/);

    act(() => host.files.append(`${SAMPLE_ROOT}/src/components/Sidebar.tsx`, '\n// rewritten by hand\n'));
    expect(await screen.findByText(/rewritten by hand/)).toBeTruthy();
  });

  it('shows a file clicked in the tree in the same tab, and one Ctrl-clicked beside it', async () => {
    render(<App host={new MockHost()} />);
    openRailSession();

    const app = await treeRow('/src/App.tsx');
    act(() => {
      fireEvent.click(app);
    });
    expect(await screen.findByText(/export default function App/)).toBeTruthy();
    expect(tabTitles()).toContain('App.tsx');
    expect(tabTitles()).not.toContain('Sidebar.tsx');

    const css = await treeRow('/src/index.css');
    act(() => {
      fireEvent.click(css, { ctrlKey: true });
    });
    expect(tabTitles().filter((t) => t === 'index.css')).toHaveLength(1);
    expect(tabTitles()).toContain('App.tsx');
  });

  it('expands and collapses folders, and lists what appears in them', async () => {
    const host = new MockHost();
    render(<App host={host} />);
    openRailSession();

    const docs = await treeRow('/docs');
    expect(screen.queryByText('plan')).toBeNull();
    act(() => {
      fireEvent.click(docs);
    });
    expect(await screen.findByText('plan')).toBeTruthy();

    act(() => host.files.write(`${SAMPLE_ROOT}/docs/NOTES.md`, '# notes\n'));
    expect(await screen.findByText('NOTES.md')).toBeTruthy();

    act(() => {
      fireEvent.click(docs);
    });
    expect(screen.queryByText('plan')).toBeNull();
  });

  it('opens a folder as a tree with nothing chosen yet', async () => {
    const host = new MockHost();
    render(<App host={host} />);
    openRailSession();
    const session = host.sessions.list().find((s) => s.title === 'Session rail + status dots')!;
    const groupId = Object.keys(session.groups)[0];
    act(() => {
      host.sessions.openFileIn(session.id, groupId, { kind: 'folder', root: `${SAMPLE_ROOT}/docs` });
    });

    expect(screen.getByText('Choose a file from the tree.')).toBeTruthy();
    expect(await screen.findByText('plan')).toBeTruthy();
  });

  it('says so for a file that is not there', async () => {
    const host = new MockHost();
    render(<App host={host} />);
    openRailSession();
    const session = host.sessions.list().find((s) => s.title === 'Session rail + status dots')!;
    const groupId = Object.keys(session.groups)[0];
    act(() => {
      host.sessions.openFileIn(session.id, groupId, { kind: 'file', path: `${SAMPLE_ROOT}/gone.md` });
    });
    expect(await screen.findByText('No such file.')).toBeTruthy();
  });
});
