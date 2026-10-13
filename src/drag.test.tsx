import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';

/** Dispatch a pointer-ish event; jsdom's PointerEvent support is patchy. */
function pointer(target: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
  target.dispatchEvent(event);
}

function dragTabTo(tab: Element, x: number, y: number) {
  // act() around the manual dispatches, or the state update the drop triggers
  // has not flushed by the time the assertions run.
  act(() => {
    fireEvent.pointerDown(tab, { clientX: 700, clientY: 50, button: 0 });
    // Two moves: the first arms past the 5px slop, the second lands on target.
    pointer(window, 'pointermove', 700, 200);
    pointer(window, 'pointermove', x, y);
    pointer(window, 'pointerup', x, y);
  });
}

function selectSessionWithTwoTabs() {
  const row = screen.getByText('Auth flow migration').closest('.session-row')!;
  fireEvent.click(row);
}

describe('tab drag', () => {
  beforeEach(() => {
    render(<App />);
    act(() => selectSessionWithTwoTabs());
  });

  afterEach(cleanup);

  it('starts with one pane holding two tabs', () => {
    expect(document.querySelectorAll('.pane')).toHaveLength(1);
    expect(document.querySelectorAll('[data-tab-id]')).toHaveLength(2);
  });

  it('splits side by side when a tab is dragged to the right edge', () => {
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 1400, 500); // far right of the pane body

    expect(document.querySelectorAll('.pane')).toHaveLength(2);
    expect(document.querySelector('.split-row')).not.toBeNull();
  });

  it('splits side by side when a tab is dragged to the left edge', () => {
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 340, 500); // far left of the pane body

    expect(document.querySelectorAll('.pane')).toHaveLength(2);
    expect(document.querySelector('.split-row')).not.toBeNull();
  });

  it('stacks top to bottom when a tab is dragged to the bottom edge', () => {
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 860, 870); // bottom centre

    expect(document.querySelectorAll('.pane')).toHaveLength(2);
    expect(document.querySelector('.split-column')).not.toBeNull();
  });

  it('splits side by side when a tab is dragged along the bar to the far right', () => {
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 1420, 50); // still inside the tab bar row

    expect(document.querySelectorAll('.pane')).toHaveLength(2);
    expect(document.querySelector('.split-row')).not.toBeNull();
  });

  it('still reorders when dragged across the middle of the bar', () => {
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 860, 50); // middle of the tab bar

    expect(document.querySelectorAll('.pane')).toHaveLength(1);
  });

  it('promotes a tab to its own session when dropped on the rail', () => {
    const before = document.querySelectorAll('.session-row').length;
    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    dragTabTo(tabs[1], 140, 400); // over the sidebar

    expect(document.querySelectorAll('.session-row').length).toBe(before + 1);
  });
});

/**
 * Rows sit under the rail's header, one pitch apart — see LAYOUT in
 * vitest.setup.ts: tops at 86, 150, 214, 278; middles at 117, 181, 245, 309.
 */
function dragRowTo(row: Element, x: number, y: number) {
  act(() => {
    fireEvent.pointerDown(row, { clientX: 100, clientY: 150, button: 0 });
    pointer(window, 'pointermove', 100, 300);
    pointer(window, 'pointermove', x, y);
    pointer(window, 'pointerup', x, y);
  });
}

const railTitles = () =>
  [...document.querySelectorAll('.session-title')].map((el) => el.textContent);
const rows = () => [...document.querySelectorAll('.session-row')];

describe('session drag', () => {
  beforeEach(() => render(<App />));
  afterEach(cleanup);

  it('moves a session to where it is dropped', () => {
    const [a, b, c, d] = railTitles();
    dragRowTo(rows()[0], 100, 260); // past the third row's middle, short of the fourth's

    expect(railTitles()).toEqual([b, c, a, d]);
  });

  it('moves a session to the top when dropped above the first row', () => {
    const [a, b, c, d] = railTitles();
    dragRowTo(rows()[3], 100, 60); // on the rail, above every row

    expect(railTitles()).toEqual([d, a, b, c]);
  });

  it('shows where the session will land while it is dragged', () => {
    const row = rows()[0];
    act(() => {
      fireEvent.pointerDown(row, { clientX: 100, clientY: 150, button: 0 });
      pointer(window, 'pointermove', 100, 300);
      pointer(window, 'pointermove', 100, 260);
    });

    expect(row.classList.contains('is-dragging')).toBe(true);
    expect(document.querySelectorAll('.session-insert')).toHaveLength(1);

    act(() => pointer(window, 'pointerup', 100, 260));
    expect(document.querySelectorAll('.session-insert')).toHaveLength(0);
  });

  it('has nowhere to land in the workspace', () => {
    const before = railTitles();
    dragRowTo(rows()[0], 860, 500); // the middle of the pane

    expect(railTitles()).toEqual(before);
    expect(document.querySelectorAll('.pane')).toHaveLength(1);
  });

  it('does not start from the × on a row', () => {
    const before = railTitles();
    dragRowTo(rows()[0].querySelector('.session-kill')!, 100, 260);

    expect(railTitles()).toEqual(before);
  });
});
