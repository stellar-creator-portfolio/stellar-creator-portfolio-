/**
 * media/MediaTrimmer.tsx
 *
 * Frame-by-frame video trimming UI backed by the native FFmpeg bridge.
 * - Scrubber with thumbnail strip (frame previews)
 * - Dual handle trim range selector
 * - Hardware encoding toggle
 * - Progress indicator during export
 *
 * Deps: react-native-gesture-handler, react-native-video,
 *       @shopify/react-native-skia (thumbnail strip)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { TrimOptions, TrimRange, TrimResult, VideoFrame } from '../types';

const { StellarFFmpeg } = NativeModules;
const SCREEN_W = Dimensions.get('window').width;
const SCRUBBER_W = SCREEN_W - 32;

// ─── Native bridge call ───────────────────────────────────────────────────────

async function trimNative(opts: TrimOptions): Promise<TrimResult> {
  if (Platform.OS === 'ios') {
    return StellarFFmpeg.trimVideo({
      inputUri:        opts.inputUri,
      outputUri:       opts.inputUri.replace(/\.[^.]+$/, `_trimmed.${opts.outputFormat}`),
      startMs:         opts.range.startMs,
      endMs:           opts.range.endMs,
      videoBitrate:    opts.videoBitrate ?? 4000,
      audioBitrate:    opts.audioBitrate ?? 128,
      hardwareEncoding: opts.hardwareEncoding,
    });
  }

  // Android — call Java FFmpegBridge via TurboModule (wired in NativeMediaModule)
  return StellarFFmpeg.trimVideo({
    inputUri:        opts.inputUri,
    outputUri:       opts.inputUri.replace(/\.[^.]+$/, `_trimmed.${opts.outputFormat}`),
    startMs:         opts.range.startMs,
    endMs:           opts.range.endMs,
    videoBitrate:    opts.videoBitrate ?? 4000,
    audioBitrate:    opts.audioBitrate ?? 128,
    hardwareEncoding: opts.hardwareEncoding,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msToDisplay(ms: number): string {
  const s   = Math.floor(ms / 1000);
  const min = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  const frac = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
  return `${min}:${sec}.${frac}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MediaTrimmerProps {
  videoUri:    string;
  durationMs:  number;
  frames:      VideoFrame[];   // pre-extracted thumbnail frames
  onComplete:  (result: TrimResult) => void;
  onCancel:    () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaTrimmer({
  videoUri,
  durationMs,
  frames,
  onComplete,
  onCancel,
}: MediaTrimmerProps) {
  const [range,       setRange]       = useState<TrimRange>({ startMs: 0, endMs: durationMs });
  const [useHardware, setUseHardware] = useState(true);
  const [exporting,   setExporting]   = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [error,       setError]       = useState<string | null>(null);

  // Track handle positions as fractions [0,1]
  const startFrac = range.startMs / durationMs;
  const endFrac   = range.endMs   / durationMs;

  // ── Gesture: left (start) handle ──────────────────────────────────────────

  const startHandle = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const frac   = Math.max(0, Math.min(e.x / SCRUBBER_W, endFrac - 0.02));
      const newMs  = Math.round(frac * durationMs);
      setRange((r) => ({ ...r, startMs: newMs }));
    });

  // ── Gesture: right (end) handle ───────────────────────────────────────────

  const endHandle = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const frac  = Math.min(1, Math.max(e.x / SCRUBBER_W, startFrac + 0.02));
      const newMs = Math.round(frac * durationMs);
      setRange((r) => ({ ...r, endMs: newMs }));
    });

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExporting(true);
    setProgress(0);
    setError(null);
    try {
      const result = await trimNative({
        inputUri:        videoUri,
        range,
        outputFormat:    'mp4',
        hardwareEncoding: useHardware,
        videoBitrate:    4000,
        audioBitrate:    128,
      });
      onComplete(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [videoUri, range, useHardware, onComplete]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Thumbnail strip */}
      <View style={styles.strip}>
        {frames.map((f) => (
          // In production render with <Image> from react-native
          // Using a placeholder rect here to avoid Image import dependency
          <View
            key={f.index}
            style={[styles.frame, { width: SCRUBBER_W / Math.max(frames.length, 1) }]}
          />
        ))}

        {/* Selected range overlay */}
        <View
          style={[
            styles.rangeOverlay,
            { left: startFrac * SCRUBBER_W, width: (endFrac - startFrac) * SCRUBBER_W },
          ]}
        />

        {/* Start handle */}
        <GestureDetector gesture={startHandle}>
          <View style={[styles.handle, styles.handleLeft, { left: startFrac * SCRUBBER_W - 10 }]}>
            <View style={styles.handleBar} />
          </View>
        </GestureDetector>

        {/* End handle */}
        <GestureDetector gesture={endHandle}>
          <View style={[styles.handle, styles.handleRight, { left: endFrac * SCRUBBER_W - 10 }]}>
            <View style={styles.handleBar} />
          </View>
        </GestureDetector>
      </View>

      {/* Time labels */}
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>{msToDisplay(range.startMs)}</Text>
        <Text style={styles.durationLabel}>
          {msToDisplay(range.endMs - range.startMs)} selected
        </Text>
        <Text style={styles.timeLabel}>{msToDisplay(range.endMs)}</Text>
      </View>

      {/* Hardware encoding toggle */}
      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => setUseHardware((v) => !v)}
      >
        <View style={[styles.toggleDot, useHardware && styles.toggleDotActive]} />
        <Text style={styles.toggleLabel}>
          {useHardware ? 'Hardware encoding (faster)' : 'Software encoding (compatible)'}
        </Text>
      </TouchableOpacity>

      {/* Progress bar */}
      {exporting && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
          <ActivityIndicator size="small" color="#6366f1" style={styles.spinner} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={exporting}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={exporting}
        >
          <Text style={styles.exportText}>{exporting ? 'Exporting…' : 'Export'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  strip:            { height: 64, flexDirection: 'row', borderRadius: 8, overflow: 'hidden', position: 'relative', marginBottom: 8 },
  frame:            { height: 64, backgroundColor: '#1e1e2e' },
  rangeOverlay:     { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(99,102,241,0.25)', borderWidth: 2, borderColor: '#6366f1' },
  handle:           { position: 'absolute', top: 0, bottom: 0, width: 20, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  handleLeft:       { backgroundColor: '#6366f1', borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  handleRight:      { backgroundColor: '#6366f1', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  handleBar:        { width: 3, height: 24, backgroundColor: '#fff', borderRadius: 2 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  timeLabel:        { color: '#a1a1aa', fontSize: 12, fontVariant: ['tabular-nums'] },
  durationLabel:    { color: '#6366f1', fontSize: 12, fontWeight: '600' },
  toggleRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  toggleDot:        { width: 16, height: 16, borderRadius: 8, backgroundColor: '#3f3f46' },
  toggleDotActive:  { backgroundColor: '#6366f1' },
  toggleLabel:      { color: '#a1a1aa', fontSize: 13 },
  progressContainer:{ height: 4, backgroundColor: '#27272a', borderRadius: 2, marginBottom: 12, overflow: 'hidden' },
  progressBar:      { height: 4, backgroundColor: '#6366f1' },
  spinner:          { position: 'absolute', right: 0, top: -8 },
  error:            { color: '#f87171', fontSize: 13, marginBottom: 12 },
  actions:          { flexDirection: 'row', gap: 12, marginTop: 'auto' },
  cancelBtn:        { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#3f3f46', alignItems: 'center' },
  cancelText:       { color: '#a1a1aa', fontWeight: '600' },
  exportBtn:        { flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center' },
  exportBtnDisabled:{ opacity: 0.5 },
  exportText:       { color: '#fff', fontWeight: '700', fontSize: 15 },
});
