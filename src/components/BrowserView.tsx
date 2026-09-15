import { useEffect, useState } from 'react';
import { useCapability, useHost } from '../host/context';
import type { Tab } from '../session/types';
import { HostSurface } from './HostSurface';

interface Props {
  tab: Tab;
  onNavigate: (url: string) => void;
}

export function BrowserView({ tab, onNavigate }: Props) {
  const host = useHost();
  const surfaceKind = useCapability('browserSurface');
  const [draft, setDraft] = useState(tab.url ?? '');
  const [syncedUrl, setSyncedUrl] = useState(tab.url);
  const [loading, setLoading] = useState(false);

  // Adjusting state during render is the documented way to reset on a prop
  // change — cheaper than an effect, and no cascading render.
  if (tab.url !== syncedUrl) {
    setSyncedUrl(tab.url);
    setDraft(tab.url ?? '');
  }

  useEffect(
    () =>
      host.surfaces.subscribe(tab.id, (event) => {
        if (event.type === 'loading') setLoading(event.loading);
        if (event.type === 'url') onNavigate(event.url);
      }),
    [host, tab.id, onNavigate],
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
          className="browser-url"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="localhost:5173"
        />
        {loading && <span className="browser-spinner" aria-label="Loading" />}
      </form>
      <HostSurface id={tab.id} url={tab.url} />
    </div>
  );
}
