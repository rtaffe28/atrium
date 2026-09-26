import { useEffect, useRef, useState } from 'react';
import { useCapability, useHost } from '../host/context';
import type { Tab } from '../session/types';
import { HostSurface } from './HostSurface';

interface Props {
  tab: Tab;
  onNavigate: (url: string) => void;
  focusUrlBar?: boolean;
  /** The page asked for a link in a new tab. */
  onOpenLink?: (url: string) => void;
}

export function BrowserView({ tab, onNavigate, focusUrlBar, onOpenLink }: Props) {
  const host = useHost();
  const surfaceKind = useCapability('browserSurface');
  const [draft, setDraft] = useState(tab.url ?? '');
  const [syncedUrl, setSyncedUrl] = useState(tab.url);
  const [loading, setLoading] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // Adjusting state during render is the documented way to reset on a prop
  // change — cheaper than an effect, and no cascading render.
  if (tab.url !== syncedUrl) {
    setSyncedUrl(tab.url);
    setDraft(tab.url ?? '');
  }

  useEffect(() => {
    if (!focusUrlBar) return;
    // focus() then select(): select() alone moves the caret without taking
    // focus, so the field looks ready to type in and is not.
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [focusUrlBar]);

  useEffect(
    () =>
      host.surfaces.subscribe(tab.id, (event) => {
        if (event.type === 'loading') setLoading(event.loading);
        if (event.type === 'url') onNavigate(event.url);
        if (event.type === 'open') onOpenLink?.(event.url);
      }),
    [host, tab.id, onNavigate, onOpenLink],
  );

  if (surfaceKind === 'none') {
    return <div className="empty">This host cannot embed web pages.</div>;
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onNavigate(/^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`);
  };

  return (
    <div className="browser">
      <form className="browser-bar" onSubmit={submit}>
        <button type="button" className="browser-nav" onClick={() => void host.surfaces.back(tab.id)} title="Back">
          ‹
        </button>
        <button type="button" className="browser-nav" onClick={() => void host.surfaces.forward(tab.id)} title="Forward">
          ›
        </button>
        <button type="button" className="browser-nav" onClick={() => void host.surfaces.reload(tab.id)} title="Reload">
          ↻
        </button>
        <input
          ref={urlRef}
          className="browser-url"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter a URL"
        />
        {loading && <span className="browser-spinner" aria-label="Loading" />}
      </form>
      {tab.url ? (
        <HostSurface id={tab.id} url={tab.url} />
      ) : (
        <div className="empty">Type a URL above.</div>
      )}
    </div>
  );
}
