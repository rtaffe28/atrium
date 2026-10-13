import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { DragCtx, type DragAction, type DragApi, type DragPayload, type DropZone } from './context';

/**
 * Pointer-based drag, not HTML5 drag-and-drop.
 *
 * HTML5 DnD cannot give us a live drop-zone preview that changes as you move
 * across a pane's edges, and its drag image is not stylable on every platform
 * — which matters here precisely because the app is meant to look identical
 * everywhere. Pointer events are more code and fully under our control.
 */

interface DragState {
  payload: DragPayload | null;
  point: { x: number; y: number };
  action: DragAction | null;
}

interface Props {
  children: ReactNode;
  onDrop: (payload: DragPayload, action: DragAction) => void;
}

export function DragProvider({ children, onDrop }: Props) {
  const [state, setState] = useState<DragState>({
    payload: null,
    point: { x: 0, y: 0 },
    action: null,
  });
  const zones = useRef(new Map<string, DropZone>());
  const latest = useRef<{ payload: DragPayload | null; action: DragAction | null }>({
    payload: null,
    action: null,
  });

  const register = useCallback((zone: DropZone) => {
    zones.current.set(zone.id, zone);
    return () => {
      zones.current.delete(zone.id);
    };
  }, []);

  const hitTest = useCallback((x: number, y: number, payload: DragPayload): DragAction | null => {
    // Only the zones for this kind of thing: a session dragged over a pane
    // has nowhere to land there, and must not read as a tab drop.
    const candidates = [...zones.current.values()]
      .filter((zone) => zone.accepts === payload.type)
      .sort((a, b) => b.priority - a.priority);
    for (const zone of candidates) {
      const rect = zone.getRect();
      if (!rect) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const action = zone.resolve(x, y, rect, payload);
      if (action) return action;
    }
    return null;
  }, []);

  const begin = useCallback(
    (payload: DragPayload, event: React.PointerEvent) => {
      const startX = event.clientX;
      const startY = event.clientY;
      let armed = false;

      const move = (e: PointerEvent) => {
        // A few pixels of slop so a click that wobbles does not read as a drag.
        if (!armed && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
        armed = true;
        const action = hitTest(e.clientX, e.clientY, payload);
        latest.current = { payload, action };
        setState({ payload, point: { x: e.clientX, y: e.clientY }, action });
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-dragging');
        const { payload: p, action } = latest.current;
        if (armed && p && action) onDrop(p, action);
        latest.current = { payload: null, action: null };
        setState({ payload: null, point: { x: 0, y: 0 }, action: null });
      };

      document.body.classList.add('is-dragging');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [hitTest, onDrop],
  );

  const api = useMemo<DragApi>(() => ({ ...state, begin, register }), [state, begin, register]);

  return (
    <DragCtx.Provider value={api}>
      {children}
      {state.payload && (
        <div
          className="drag-ghost"
          style={{ transform: `translate(${state.point.x + 12}px, ${state.point.y + 12}px)` }}
        >
          {state.payload.type === 'tab' && (
            <span className={`tab-glyph glyph-${state.payload.kind}`} />
          )}
          {state.payload.title}
        </div>
      )}
    </DragCtx.Provider>
  );
}
