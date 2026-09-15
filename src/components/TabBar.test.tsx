import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';

function openSessionWithTwoTabs() {
  act(() => {
    fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
  });
}

const tabCount = () => document.querySelectorAll('[data-tab-id]').length;

describe('creating tabs', () => {
  afterEach(cleanup);

  it('adds a terminal from the pane + button', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = tabCount();

    act(() => fireEvent.click(screen.getByTitle('New terminal in this pane')));

    expect(tabCount()).toBe(before + 1);
  });

  it('adds a terminal from the title bar', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = tabCount();

    act(() => fireEvent.click(screen.getByTitle('New terminal tab')));

    expect(tabCount()).toBe(before + 1);
  });

  it('adds a browser from the title bar', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = tabCount();

    act(() => fireEvent.click(screen.getByTitle('New browser tab')));

    expect(tabCount()).toBe(before + 1);
  });

  /**
   * A new tab should land in the pane you were last working in, not always the
   * first one — otherwise the buttons feel arbitrary once the view is split.
   */
  it('adds the tab to the pane that was last touched', () => {
    render(<App />);
    openSessionWithTwoTabs();

    // Split so there are two panes, then touch the second one.
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    act(() => {
      fireEvent.pointerDown(tabs[1], { clientX: 700, clientY: 50, button: 0 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700, clientY: 400 }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1400, clientY: 500 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 1400, clientY: 500 }));
    });

    const panes = [...document.querySelectorAll('.pane')];
    expect(panes).toHaveLength(2);

    const secondPaneTabsBefore = panes[1].querySelectorAll('[data-tab-id]').length;
    act(() => fireEvent.pointerDown(panes[1]));
    act(() => fireEvent.click(screen.getByTitle('New terminal tab')));

    const after = [...document.querySelectorAll('.pane')][1].querySelectorAll('[data-tab-id]').length;
    expect(after).toBe(secondPaneTabsBefore + 1);
  });
});

describe('the session rail', () => {
  afterEach(cleanup);

  it('opens a session when blank rail space is double-clicked', () => {
    render(<App />);
    const before = document.querySelectorAll('.session-row').length;

    act(() => fireEvent.doubleClick(document.querySelector('.session-list')!));

    expect(document.querySelectorAll('.session-row').length).toBe(before + 1);
  });

  /** A double-click on a row is about that row, not a request for a new one. */
  it('does not open a session when a row is double-clicked', () => {
    render(<App />);
    const before = document.querySelectorAll('.session-row').length;

    act(() => fireEvent.doubleClick(document.querySelector('.session-row')!));

    expect(document.querySelectorAll('.session-row').length).toBe(before);
  });
});

describe('the empty workspace', () => {
  afterEach(cleanup);

  it('opens a session on double click', () => {
    render(<App />);
    // Kill every session so the empty state is showing.
    act(() => {
      for (const kill of document.querySelectorAll('.session-kill')) fireEvent.click(kill);
    });
    expect(document.querySelector('.empty')).not.toBeNull();

    act(() => fireEvent.doubleClick(document.querySelector('.empty')!));

    expect(document.querySelectorAll('.session-row').length).toBe(1);
  });
});
