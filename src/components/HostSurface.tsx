import { useEffect, useRef, useState } from 'react';
import { useHost } from '../host/context';

interface Props {
  id: string;
  /** Where to start. Read when the surface is mounted, and not again. */
  url?: string;
}

/**
 * A container the host fills with embedded web content.
 *
 * The app never names iframe or webview — it hands over a box and the host
 * decides what goes in it. Mount happens once per surface id, at `url`, and
 * from then on the surface owns where it is: what the user asks for goes
 * through host.surfaces.navigate(), and where the page actually went comes
 * back as a `url` event for the app to record.
 *
 * The URL prop is deliberately not pushed into the surface when it changes.
 * It used to be, and that was a loop: the page reports a URL, the app records
 * it, the record is pushed back as the webview's src, and Electron reloads a
 * webview whose src is assigned its own value. One extra load per click at
 * best; forever for any page that lands somewhere new each time it loads — a
 * login redirect with a fresh token, a cache-busting query — which was the
 * browser pane flickering until the tab was closed.
 */
export function HostSurface({ id, url }: Props) {
  const host = useHost();
  const containerRef = useRef<HTMLDivElement>(null);
  // Where this surface started. The browser view is keyed by tab, so a
  // surface is mounted once per tab, and the URL it was first given is the
  // only one that matters here.
  const [startUrl] = useState(url);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return host.surfaces.mount(id, container, { url: startUrl });
  }, [host, id, startUrl]);

  return <div className="surface-host" ref={containerRef} />;
}
