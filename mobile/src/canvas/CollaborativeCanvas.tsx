/**
 * canvas/CollaborativeCanvas.tsx
 *
 * Full collaborative canvas screen.
 * - Touch input → Yjs mutations (broadcast to all peers)
 * - Yjs state → SkiaCanvasRenderer (native, <1 frame latency)
 * - Collaborator cursors rendered as coloured dots
 *
 * Deps: @shopify/react-native-skia, yjs, y-websocket,
 *       react-native-gesture-handler
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, useCanvasRef } from '@shopify/react-native-skia';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { CanvasYjsProvider } from './yjs-provider';
import { SkiaCanvasRenderer } from './skia-renderer';
import type { CanvasState, VectorPath } from '../types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  roomId: string;
  userId: string;
  displayName: string;
  userColor: string;
  strokeColor?: string;
  strokeWidth?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CollaborativeCanvas({
  roomId,
  userId,
  displayName,
  userColor,
  strokeColor = '#6366f1',
  strokeWidth = 3,
}: Props) {
  const canvasRef  = useCanvasRef();
  const renderer   = useMemo(() => new SkiaCanvasRenderer(), []);
  const yjsRef     = useRef<CanvasYjsProvider | null>(null);
  const activeRef  = useRef<VectorPath | null>(null);
  const [state, setState] = useState<CanvasState>({
    paths: {},
    activePath: null,
    collaborators: {},
  });

  // ── Yjs setup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const provider = new CanvasYjsProvider(roomId, userId, displayName, userColor);
    yjsRef.current = provider;

    const unsub = provider.onStateChange((s) => {
      setState(s);
      canvasRef.current?.redraw();
    });

    return () => {
      unsub();
      provider.destroy();
      renderer.dispose();
    };
  }, [roomId, userId, displayName, userColor]);

  // ── Touch gestures ──────────────────────────────────────────────────────────

  const newPathId = () => `${userId}-${Date.now()}`;

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      const path: VectorPath = {
        id:          newPathId(),
        userId,
        color:       strokeColor,
        strokeWidth,
        points:      [{ x: e.x, y: e.y, pressure: e.force ?? 1 }],
        closed:      false,
        timestamp:   Date.now(),
      };
      activeRef.current = path;
      yjsRef.current?.startPath(path);
    })
    .onUpdate((e) => {
      const active = activeRef.current;
      if (!active) return;
      yjsRef.current?.appendPoint(active.id, e.x, e.y, e.force ?? 1);
      yjsRef.current?.updateCursor(e.x, e.y);
      // Optimistic local update for zero-latency feel
      active.points.push({ x: e.x, y: e.y, pressure: e.force ?? 1 });
      canvasRef.current?.redraw();
    })
    .onEnd(() => {
      if (activeRef.current) {
        yjsRef.current?.closePath(activeRef.current.id);
        activeRef.current = null;
      }
    });

  // ── Skia draw callback ──────────────────────────────────────────────────────

  const onDraw = useCallback(
    (canvas: import('@shopify/react-native-skia').SkCanvas) => {
      renderer.render(canvas, state.paths, activeRef.current);
      renderer.renderCursors(
        canvas,
        Object.values(state.collaborators).map((c) => ({
          x:     c.point.x,
          y:     c.point.y,
          color: c.color,
        })),
      );
    },
    [state.paths, state.collaborators],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={pan}>
        <View style={styles.root}>
          <Canvas ref={canvasRef} style={styles.root} onDraw={onDraw} />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
});
