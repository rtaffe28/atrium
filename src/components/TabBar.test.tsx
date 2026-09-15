import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';

function openSessionWithTwoTabs() {
  act(() => {
    fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
  });
}

describe('the + menu', () => {
  afterEach(cleanup);

  it('adds a terminal tab', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = document.querySelectorAll('[data-tab-id]').length;

    act(() => fireEvent.click(document.querySelector('.tab-add button')!));
    act(() => fireEvent.click(screen.getByText('Terminal')));

    expect(document.querySelectorAll('[data-tab-id]').length).toBe(before + 1);
  });

  it('adds a browser tab', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = document.querySelectorAll('[data-tab-id]').length;

    act(() => fireEvent.click(document.querySelector('.tab-add button')!));
    act(() => fireEvent.click(screen.getByText('Browser')));

    expect(document.querySelectorAll('[data-tab-id]').length).toBe(before + 1);
  });

  /**
   * The menu must not live inside the tab bar.
   *
   * .tabbar scrolls horizontally, and an overflow container clips
   * absolutely-positioned children — which made the dropdown render but be
   * invisible and unclickable. jsdom applies no CSS and so cannot see the
   * clipping; asserting where the node lands is the part that is testable,
   * and it is exactly the property the fix relies on.
   */
  it('portals the menu out of the scrolling tab bar', () => {
    render(<App />);
    openSessionWithTwoTabs();
    act(() => fireEvent.click(document.querySelector('.tab-add button')!));

    const menu = document.querySelector('.menu');
    expect(menu).not.toBeNull();
    expect(menu!.closest('.tabbar')).toBeNull();
  });

  it('closes without adding anything when the scrim is clicked', () => {
    render(<App />);
    openSessionWithTwoTabs();
    const before = document.querySelectorAll('[data-tab-id]').length;

    act(() => fireEvent.click(document.querySelector('.tab-add button')!));
    act(() => fireEvent.click(document.querySelector('.menu-scrim')!));

    expect(document.querySelector('.menu')).toBeNull();
    expect(document.querySelectorAll('[data-tab-id]').length).toBe(before);
  });
});
