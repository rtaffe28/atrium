import type { FocusRequest } from '../focusRequest';
import { useRef } from 'react';
import { announceSettled } from '../layout/settle';
import type { LayoutNode, Session, SessionDriver } from '../session/types';
import { PaneView } from './PaneView';

/** The smallest share of a split either pane may be dragged down to. */
const MIN = 0.1;
const MAX = 1 - MIN;

interface Props {
  node: LayoutNode;
  onFocus: (groupId: string) => void;
  focusRequest?: FocusRequest | null;
  /** Child-index path from the layout root, so setSizes can find this split. */
  path: number[];
  session: Session;
  driver: SessionDriver;
}

export function PaneTree({ node, path, session, driver, onFocus, focusRequest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'leaf') {
    return (
      <PaneView
        session={session}
        groupId={node.groupId}
        driver={driver}
        onFocus={onFocus}
        focusRequest={focusRequest}
      />
    );
  }

  const horizontal = node.direction === 'row';
  // Clamp so a pane can never be dragged to nothing and become unclickable.
  const setFirst = (fraction: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, fraction));
    driver.setSizes(session.id, path, [clamped, 1 - clamped]);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const splitter = event.currentTarget;
    // Capture keeps the drag alive when the pointer outruns the 9px handle.
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add('is-active');

    const move = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setFirst(
        horizontal ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height,
      );
    };

    const up = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      splitter.classList.remove('is-active');
      document.body.classList.remove('is-resizing', `is-resizing-${node.direction}`);
      announceSettled();
    };

    document.body.classList.add('is-resizing', `is-resizing-${node.direction}`);
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  };

  const nudge = (event: React.KeyboardEvent) => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const ahead = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== ahead) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.02;
    setFirst(node.sizes[0] + (event.key === ahead ? step : -step));
  };

  return (
    <div className={`split split-${node.direction}`} ref={containerRef}>
      <div className="split-child" style={{ flexGrow: node.sizes[0] }}>
        <PaneTree
          node={node.children[0]}
          path={[...path, 0]}
          session={session}
          driver={driver}
          onFocus={onFocus}
          focusRequest={focusRequest}
        />
      </div>
      <div
        className={`splitter splitter-${node.direction}`}
        onPointerDown={startResize}
        onDoubleClick={() => setFirst(0.5)}
        onKeyDown={nudge}
        tabIndex={0}
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(node.sizes[0] * 100)}
        title="Drag to resize · double-click to even out"
      />
      <div className="split-child" style={{ flexGrow: node.sizes[1] }}>
        <PaneTree
          node={node.children[1]}
          path={[...path, 1]}
          session={session}
          driver={driver}
          onFocus={onFocus}
          focusRequest={focusRequest}
        />
      </div>
    </div>
  );
}
