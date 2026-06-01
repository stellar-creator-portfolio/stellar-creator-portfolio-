/**
 * canvas/yjs-provider.ts
 *
 * Yjs document + WebSocket provider for real-time collaborative canvas.
 * Deps (add to mobile package.json):
 *   yjs, y-websocket, lib0
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { VectorPath, CollaboratorCursor, CanvasState } from '../types';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'wss://api.stellar.dev/collab';

// ─── Document structure ───────────────────────────────────────────────────────
// Y.Map<VectorPath>  — shared paths, keyed by path id
// Y.Map<CollaboratorCursor> — awareness state per peer

export class CanvasYjsProvider {
  readonly doc: Y.Doc;
  readonly paths: Y.Map<VectorPath>;
  private provider: WebsocketProvider;
  private roomId: string;

  constructor(roomId: string, userId: string, displayName: string, color: string) {
    this.roomId = roomId;
    this.doc    = new Y.Doc();
    this.paths  = this.doc.getMap<VectorPath>('paths');

    this.provider = new WebsocketProvider(WS_URL, roomId, this.doc, {
      connect: true,
      // Reconnect with exponential back-off (built into y-websocket)
      WebSocketPolyfill: WebSocket,
    });

    // Publish local awareness (cursor / user info)
    this.provider.awareness.setLocalState({
      userId,
      displayName,
      color,
      point: { x: 0, y: 0 },
      lastSeen: Date.now(),
    } satisfies CollaboratorCursor);
  }

  // ── Path mutations ──────────────────────────────────────────────────────────

  startPath(path: VectorPath): void {
    this.doc.transact(() => {
      this.paths.set(path.id, path);
    });
  }

  appendPoint(pathId: string, x: number, y: number, pressure = 1): void {
    this.doc.transact(() => {
      const existing = this.paths.get(pathId);
      if (!existing) return;
      this.paths.set(pathId, {
        ...existing,
        points: [...existing.points, { x, y, pressure }],
      });
    });
  }

  closePath(pathId: string): void {
    this.doc.transact(() => {
      const existing = this.paths.get(pathId);
      if (!existing) return;
      this.paths.set(pathId, { ...existing, closed: true });
    });
  }

  deletePath(pathId: string): void {
    this.doc.transact(() => {
      this.paths.delete(pathId);
    });
  }

  // ── Cursor ──────────────────────────────────────────────────────────────────

  updateCursor(x: number, y: number): void {
    const local = this.provider.awareness.getLocalState() as CollaboratorCursor;
    this.provider.awareness.setLocalState({ ...local, point: { x, y }, lastSeen: Date.now() });
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  onStateChange(cb: (state: CanvasState) => void): () => void {
    const rebuild = () => {
      const paths: Record<string, VectorPath> = {};
      this.paths.forEach((v, k) => { paths[k] = v; });

      const collaborators: Record<string, CollaboratorCursor> = {};
      this.provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId !== this.doc.clientID && state) {
          collaborators[(state as CollaboratorCursor).userId] = state as CollaboratorCursor;
        }
      });

      cb({ paths, activePath: null, collaborators });
    };

    this.paths.observe(rebuild);
    this.provider.awareness.on('change', rebuild);

    return () => {
      this.paths.unobserve(rebuild);
      this.provider.awareness.off('change', rebuild);
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.doc.destroy();
  }
}
