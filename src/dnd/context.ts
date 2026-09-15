import { createContext, useContext } from 'react';
import type { DropAction } from '../session/types';

export interface DragPayload {
  tabId: string;
  sessionId: string;
  title: string;
  kind: 'terminal' | 'browser';
}

/** A registered drop zone. `resolve` returns null if the point misses. */
export interface DropZone {
  id: string;
  /** Higher wins when zones overlap; tab bars sit above pane bodies. */
  priority: number;
  getRect: () => DOMRect | null;
  resolve: (x: number, y: number, rect: DOMRect) => DropAction | null;
}

export interface DragApi {
  payload: DragPayload | null;
  point: { x: number; y: number };
  action: DropAction | null;
  begin: (payload: DragPayload, event: React.PointerEvent) => void;
  register: (zone: DropZone) => () => void;
}

export const DragCtx = createContext<DragApi | null>(null);

export function useDrag(): DragApi {
  const api = useContext(DragCtx);
  if (!api) throw new Error('useDrag must be used inside <DragProvider>');
  return api;
}
