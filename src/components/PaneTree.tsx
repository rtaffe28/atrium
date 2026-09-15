import { useRef } from 'react';
import type { LayoutNode, Session, SessionDriver } from '../session/types';
import { PaneView } from './PaneView';

interface Props {
  node: LayoutNode;
  /** Child-index path from the layout root, so setSizes can find this split. */
  path: number[];
  session: Session;
  driver: SessionDriver;
}

export function PaneTree({ node, path, session, driver }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'leaf') {
    return <PaneView session={session} groupId={node.groupId} driver={driver} />;
  }

  const horizontal = node.direction === 'row';

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const move = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const fraction = horizontal
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      // Clamp so a pane can never be dragged to nothing and become unclickable.
      const clamped = Math.min(0.85, Math.max(0.15, fraction));
      driver.setSizes(session.id, path, [clamped, 1 - clamped]);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
    };

    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`split split-${node.direction}`} ref={containerRef}>
      <div className="split-child" style={{ flexGrow: node.sizes[0] }}>
        <PaneTree node={node.children[0]} path={[...path, 0]} session={session} driver={driver} />
      </div>
      <div
        className={`splitter splitter-${node.direction}`}
        onPointerDown={startResize}
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      />
      <div className="split-child" style={{ flexGrow: node.sizes[1] }}>
        <PaneTree node={node.children[1]} path={[...path, 1]} session={session} driver={driver} />
      </div>
    </div>
  );
}
