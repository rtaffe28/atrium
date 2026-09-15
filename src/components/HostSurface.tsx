import { useEffect, useRef } from 'react';
import { useHost } from '../host/context';

interface Props {
  id: string;
  url?: string;
}

/**
 * A container the host fills with embedded web content.
 *
 * The app never names iframe or webview — it hands over a box and the host
 * decides what goes in it. Mount happens once per surface id; later URL
 * changes go through navigate() so history survives.
 */
export function HostSurface({ id, url }: Props) {
  const host = useHost();
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    mountedUrl.current = url;
    return host.surfaces.mount(id, container, { url });
    // Intentionally not re-running on url: navigation is handled below, and
    // remounting on every keystroke in the URL bar would reset history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, id]);

  useEffect(() => {
    if (url && mountedUrl.current !== undefined && url !== mountedUrl.current) {
      mountedUrl.current = url;
      void host.surfaces.navigate(id, url);
    }
  }, [host, id, url]);

  return <div className="surface-host" ref={containerRef} />;
}
