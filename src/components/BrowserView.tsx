import { useEffect, useRef, useState } from 'react';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useCapability, useHost } from '../host/context';
import { toUrl } from '../links';
import type { Tab } from '../session/types';
import { HostSurface } from './HostSurface';

interface Props {
  tab: Tab;
  /** The page is at `url`: record it. Never a request to go there. */
  onNavigate: (url: string) => void;
  /** The page named itself. */
  onTitle: (title: string) => void;
  focusRequest?: FocusRequest | null;
  /** The page asked for a link in a new tab. */
  onOpenLink?: (url: string) => void;
}

/** The toolbar's glyphs, on the 16-unit grid the title bar's are drawn on. */
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  back: 'M9.75 3.5 5.25 8l4.5 4.5',
  forward: 'M6.25 3.5 10.75 8l-4.5 4.5',
  reload: 'M15.33 2.67v4h-4M13.66 10a6 6 0 1 1-1.41-6.24L15.33 6.67',
  devtools: 'M10.67 12l4-4-4-4M5.33 4l-4 4 4 4',
  external:
    'M12 8.67v4a1.33 1.33 0 0 1-1.33 1.33H3.33A1.33 1.33 0 0 1 2 12.67V5.33A1.33 1.33 0 0 1 3.33 4h4M10 2h4v4M6.67 9.33 14 2',
};

/**
 * A browser pane, laid out the way VS Code's integrated browser and Cursor's
 * are: back, forward and reload on the left, the address bar taking the
 * width, the page's tools on the right.
 *
 * The surface owns where it is. Enter in the address bar asks it to go
 * somewhere; everything the page does for itself — a clicked link, a
 * redirect, a hash change — comes back as a `url` event, which is recorded
 * and shown but never sent back down. HostSurface says why.
 */
export function BrowserView({ tab, onNavigate, onTitle, focusRequest, onOpenLink }: Props) {
  const host = useHost();
  const surfaceKind = useCapability('browserSurface');
  const [draft, setDraft] = useState(tab.url ?? '');
  const [syncedUrl, setSyncedUrl] = useState(tab.url);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false });
  const urlRef = useRef<HTMLInputElement>(null);

  // The address bar follows the page. Adjusting state during render is the
  // documented way to reset on a prop change — cheaper than an effect, and no
  // cascading render.
  if (tab.url !== syncedUrl) {
    setSyncedUrl(tab.url);
    setDraft(tab.url ?? '');
  }

  // Claimed here and not during render: React's development mode renders a
  // component twice and keeps the second result, and a one-shot request
  // claimed by the first render is spent by then. An effect runs once per
  // mount, and the focus it gives survives being asked again.
  useEffect(() => {
    if (!claimFocus(focusRequest ?? null, tab.id)) return;
    // focus() then select(): select() alone moves the caret without taking
    // focus, so the field looks ready to type in and is not.
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [focusRequest, tab.id]);

  useEffect(
    () =>
      host.surfaces.subscribe(tab.id, (event) => {
        switch (event.type) {
          case 'loading':
            setLoading(event.loading);
            break;
          case 'url':
            setHistory({ canGoBack: event.canGoBack, canGoForward: event.canGoForward });
            onNavigate(event.url);
            break;
          case 'title':
            // A page with no title of its own keeps its host as a name.
            if (event.title.trim()) onTitle(event.title);
            break;
          case 'open':
            onOpenLink?.(event.url);
            break;
        }
      }),
    [host, tab.id, onNavigate, onTitle, onOpenLink],
  );

  if (surfaceKind === 'none') {
    return <div className="empty">This host cannot embed web pages.</div>;
  }

  const go = (url: string) => {
    // Recorded first, so a blank tab has a URL to mount its surface at. On a
    // tab that already has one, navigate() does the loading, and the record
    // is corrected when the page reports where it actually landed.
    onNavigate(url);
    void host.surfaces.navigate(tab.id, url);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const url = toUrl(draft);
    if (!url) return;
    go(url);
    urlRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    // The first Escape puts the page's URL back; a second leaves the bar.
    if (draft !== (tab.url ?? '')) setDraft(tab.url ?? '');
    else urlRef.current?.blur();
  };

  // window.open from the app's own window never opens a window: under
  // Electron the main process hands the URL to the system browser, and in a
  // browser tab it is a new tab. Both are what "open externally" means.
  const openExternal = () => {
    if (tab.url) window.open(tab.url, '_blank', 'noopener');
  };

  const nav = (label: string, icon: string, onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      className="icon-button subtle"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon d={icon} />
    </button>
  );

  return (
    <div className="browser">
      <form className="browser-bar" onSubmit={submit}>
        {nav('Back', ICON.back, () => void host.surfaces.back(tab.id), !history.canGoBack)}
        {nav('Forward', ICON.forward, () => void host.surfaces.forward(tab.id), !history.canGoForward)}
        {nav('Reload', ICON.reload, () => void host.surfaces.reload(tab.id), !tab.url)}
        <div className="browser-address">
          <input
            ref={urlRef}
            className="browser-url"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Enter a URL"
            aria-label="Address"
          />
          {loading && <span className="browser-spinner" aria-label="Loading" />}
        </div>
        {/* An iframe has no developer tools of its own; the page around it
            is inspected with the browser's. */}
        {surfaceKind === 'webview' &&
          nav('Developer tools', ICON.devtools, () => void host.surfaces.toggleDevTools(tab.id), !tab.url)}
        {nav('Open in external browser', ICON.external, openExternal, !tab.url)}
      </form>
      {tab.url ? (
        <HostSurface id={tab.id} url={tab.url} />
      ) : (
        <div className="empty">Type a URL above.</div>
      )}
    </div>
  );
}
