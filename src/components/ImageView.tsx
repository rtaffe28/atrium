import { useState } from 'react';
import { basename } from '../paths';

interface Props {
  path: string;
  dataUrl: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** An image, fitted to the pane; a click shows it at its own size. */
export function ImageView({ path, dataUrl, size }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  return (
    <div className={`image-view${fit ? ' is-fit' : ''}`} onClick={() => setFit((f) => !f)}>
      <img
        src={dataUrl}
        alt={basename(path)}
        title={fit ? 'Actual size' : 'Fit to the pane'}
        onLoad={(event) =>
          setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
        }
      />
      <div className="image-caption">
        {dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ''}
        {formatSize(size)}
      </div>
    </div>
  );
}
