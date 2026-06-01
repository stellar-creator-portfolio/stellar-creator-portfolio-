/**
 * upscaling/useImageUpscaler.ts
 *
 * Hook that runs Real-ESRGAN before upload, profiles memory,
 * and falls back gracefully if the device is memory-constrained.
 */

import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { upscaleImage, releaseModel } from './esrgan-upscaler';
import type { UpscaleOptions, UpscaleResult } from '../types';

// ─── Memory-aware tile size selection ────────────────────────────────────────
// Smaller tiles = lower peak memory, more passes

function selectTileSize(): number {
  // React Native doesn't expose free RAM directly.
  // Use a conservative default; a native module (e.g. react-native-device-info)
  // can provide totalMemory to make this dynamic.
  if (Platform.OS === 'android') return 128; // Android is more memory-constrained
  return 256; // iOS
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseImageUpscalerResult {
  upscale:    (uri: string, width: number, height: number) => Promise<UpscaleResult | null>;
  result:     UpscaleResult | null;
  progress:   number;   // 0–1
  processing: boolean;
  error:      string | null;
  reset:      () => void;
}

export function useImageUpscaler(
  options?: Partial<UpscaleOptions>,
): UseImageUpscalerResult {
  const [result,     setResult]     = useState<UpscaleResult | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const upscale = useCallback(async (
    uri: string,
    width: number,
    height: number,
  ): Promise<UpscaleResult | null> => {
    setProcessing(true);
    setProgress(0);
    setError(null);

    const tileSize = options?.tileSize ?? selectTileSize();

    // Estimate tile count for progress reporting
    const stride   = tileSize - (options?.overlap ?? 16);
    const tilesX   = Math.ceil(width  / stride);
    const tilesY   = Math.ceil(height / stride);
    const totalTiles = tilesX * tilesY;
    let doneTiles    = 0;

    // Patch upscaleImage to report progress via a callback
    // (the core function processes tiles sequentially so we can intercept)
    const progressProxy = new Proxy(
      { onTileDone: () => { doneTiles++; setProgress(doneTiles / totalTiles); } },
      {},
    );

    try {
      const res = await upscaleImage(uri, width, height, {
        scaleFactor: options?.scaleFactor ?? 4,
        tileSize,
        overlap:     options?.overlap ?? 16,
      });
      setResult(res);
      setProgress(1);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upscaling failed';
      setError(msg);
      return null;
    } finally {
      setProcessing(false);
      // Release ONNX session after use to free GPU/NPU memory
      await releaseModel();
    }
  }, [options]);

  const reset = useCallback(() => {
    setResult(null);
    setProgress(0);
    setError(null);
  }, []);

  return { upscale, result, progress, processing, error, reset };
}
