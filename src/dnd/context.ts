import { createContext, useContext } from 'react';
import type { DropAction, RailOrder, TabKind } from '../session/types';

/** What is being dragged: a tab between panes, or a session along the rail. */
export type DragPayload =
  | { type: 'tab'; tabId: string; sessionId: string; title: string; kind: TabKind }
  | { type: 'session'; sessionId: string; title: string };

/** Where a drag may land. */
export type DragAction = DropAction | RailOrder;

/** A registered drop zone. `resolve` returns null if the point misses. */
export interface DropZone {
  id: string;
  /** What this zone takes. A drag of anything else passes straight through it. */
  accepts: DragPayload['type'];
  /** Higher wins when zones overlap; tab bars sit above pane bodies. */
  priority: number;
  getRect: () => DOMRect | null;
  resolve: (x: number, y: number, rect: DOMRect, payload: DragPayload) => DragAction | null;
}

export interface DragApi {
  payload: DragPayload | null;
  point: { x: number; y: number };
  action: DragAction | null;
  begin: (payload: DragPayload, event: React.PointerEvent) => void;
  register: (zone: DropZone) => () => void;
}

export const DragCtx = createContext<DragApi | null>(null);

export function useDrag(): DragApi {
  const api = useContext(DragCtx);
  if (!api) throw new Error('useDrag must be used inside <DragProvider>');
  return api;
}
