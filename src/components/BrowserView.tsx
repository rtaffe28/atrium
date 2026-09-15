import { useState } from 'react';
import type { Tab } from '../session/types';

interface Props {
  tab: Tab;
  onNavigate: (url: string) => void;
}

/**
 * A browser tab.
 *
 * In the mock this is an iframe, which means any site sending
 * X-Frame-Options: DENY (most of them) will refuse to render. That is a
 * limitation of the browser mock, not of the design — under Electron this
 * becomes a <webview>, which has no such restriction. Local dev servers,
 * which are the actual use case, iframe fine.
 */
export function BrowserView({ tab, onNavigate }: Props) {
  const [draft, setDraft] = useState(tab.url ?? '');
  const [syncedUrl, setSyncedUrl] = useState(tab.url);

  // Adjusting state during render is the documented way to reset on a prop
  // change — cheaper than an effect, and no cascading render.
  if (tab.url !== syncedUrl) {
    setSyncedUrl(tab.url);
    setDraft(tab.url ?? '');
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
        <button type="button" className="browser-nav" onClick={() => onNavigate(tab.url ?? '')}>
          ↻
        </button>
        <input
          className="browser-url"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="localhost:5173"
        />
      </form>
      {tab.url ? (
        <iframe className="browser-frame" src={tab.url} title={tab.title} />
      ) : (
        <div className="browser-blank">No page loaded</div>
      )}
    </div>
  );
}
