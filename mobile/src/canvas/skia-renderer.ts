/**
 * canvas/skia-renderer.ts
 *
 * Native canvas renderer using @shopify/react-native-skia.
 * Converts Yjs VectorPath objects → Skia Path objects with Catmull-Rom
 * spline smoothing for extremely low-latency, sub-pixel rendering.
 *
 * Deps (add to mobile package.json):
 *   @shopify/react-native-skia
 */

import {
  Skia,
  type SkPath,
  type SkPaint,
  type SkCanvas,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
} from '@shopify/react-native-skia';
import type { VectorPath, Point } from '../types';

// ─── Catmull-Rom → cubic Bézier conversion ────────────────────────────────────
// Gives smooth curves through all recorded touch points.

function catmullRomToBezier(points: Point[]): SkPath {
  const path = Skia.Path.Make();
  if (points.length === 0) return path;
  if (points.length === 1) {
    path.moveTo(points[0].x, points[0].y);
    return path;
  }

  path.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom tension = 0.5
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.cubicTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  return path;
}

// ─── Paint factory ────────────────────────────────────────────────────────────

function makePaint(color: string, strokeWidth: number, alpha = 1): SkPaint {
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(strokeWidth);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setAntiAlias(true);
  paint.setAlphaf(alpha);
  return paint;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class SkiaCanvasRenderer {
  // Cache compiled SkPath objects — only recompile when a path changes
  private pathCache = new Map<string, { hash: number; skPath: SkPath }>();

  private hashPath(vp: VectorPath): number {
    // Fast hash: point count + last point coords
    const last = vp.points[vp.points.length - 1];
    return vp.points.length * 31 + (last ? last.x * 17 + last.y : 0);
  }

  private getSkPath(vp: VectorPath): SkPath {
    const hash    = this.hashPath(vp);
    const cached  = this.pathCache.get(vp.id);
    if (cached && cached.hash === hash) return cached.skPath;

    const skPath = catmullRomToBezier(vp.points);
    if (vp.closed) skPath.close();
    this.pathCache.set(vp.id, { hash, skPath });
    return skPath;
  }

  /**
   * Called inside a Skia <Canvas> onDraw callback.
   * Renders all committed paths + the active in-progress path.
   */
  render(
    canvas: SkCanvas,
    paths: Record<string, VectorPath>,
    activePath: VectorPath | null,
  ): void {
    // Committed paths
    for (const vp of Object.values(paths)) {
      const skPath = this.getSkPath(vp);
      const paint  = makePaint(vp.color, vp.strokeWidth);
      canvas.drawPath(skPath, paint);
    }

    // Active (in-progress) path — drawn with slight transparency for feedback
    if (activePath && activePath.points.length > 1) {
      const skPath = catmullRomToBezier(activePath.points);
      const paint  = makePaint(activePath.color, activePath.strokeWidth, 0.85);
      canvas.drawPath(skPath, paint);
    }
  }

  /**
   * Render remote collaborator cursors as small filled circles.
   */
  renderCursors(
    canvas: SkCanvas,
    cursors: Array<{ x: number; y: number; color: string }>,
  ): void {
    for (const c of cursors) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(c.color));
      paint.setAntiAlias(true);
      canvas.drawCircle(c.x, c.y, 6, paint);
    }
  }

  invalidate(pathId: string): void {
    this.pathCache.delete(pathId);
  }

  dispose(): void {
    this.pathCache.clear();
  }
}
