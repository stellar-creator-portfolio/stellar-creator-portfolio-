import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import Video, {
  type VideoRef,
  type OnLoadData,
  type OnProgressData,
  type OnBandwidthUpdateData,
} from 'react-native-video';
import NetInfo from '@react-native-community/netinfo';

export type QualityLevel = 'auto' | '1080p' | '720p' | '480p' | '360p' | '240p';

export interface HLSSource {
  uri: string;
  headers?: Record<string, string>;
}

interface AdaptiveVideoPlayerProps {
  source: HLSSource;
  style?: ViewStyle;
  autoPlay?: boolean;
  muted?: boolean;
  onQualityChange?: (level: QualityLevel) => void;
  onError?: (error: string) => void;
  onProgress?: (progress: OnProgressData) => void;
  posterUri?: string;
}

const BITRATE_QUALITY_MAP: Array<{ maxKbps: number; level: QualityLevel }> = [
  { maxKbps: 500, level: '240p' },
  { maxKbps: 1000, level: '360p' },
  { maxKbps: 2500, level: '480p' },
  { maxKbps: 5000, level: '720p' },
  { maxKbps: Infinity, level: '1080p' },
];

function bitrateToQuality(kbps: number): QualityLevel {
  for (const { maxKbps, level } of BITRATE_QUALITY_MAP) {
    if (kbps <= maxKbps) return level;
  }
  return '1080p';
}

// Platform-specific buffer config for ExoPlayer (Android) and AVPlayer (iOS)
const BUFFER_CONFIG = Platform.select({
  android: {
    minBufferMs: 2500,
    maxBufferMs: 30_000,
    bufferForPlaybackMs: 1500,
    bufferForPlaybackAfterRebufferMs: 3000,
  },
  ios: undefined,
  default: undefined,
});

export const AdaptiveVideoPlayer: React.FC<AdaptiveVideoPlayerProps> = ({
  source,
  style,
  autoPlay = true,
  muted = false,
  onQualityChange,
  onError,
  onProgress,
  posterUri,
}) => {
  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(!autoPlay);
  const [loading, setLoading] = useState(true);
  const [currentQuality, setCurrentQuality] = useState<QualityLevel>('auto');
  const [bandwidth, setBandwidth] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkType, setNetworkType] = useState<string>('unknown');

  // Track network quality to proactively limit max bitrate on cellular
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setNetworkType(state.type);
    });
    return () => unsub();
  }, []);

  const maxBitrateBps = useCallback((): number | undefined => {
    if (networkType === 'cellular') {
      // Cap at 720p on cellular to reduce data usage
      return 5_000_000;
    }
    return undefined;
  }, [networkType]);

  const handleBandwidthUpdate = useCallback(
    (data: OnBandwidthUpdateData) => {
      const kbps = Math.round(data.bitrate / 1000);
      setBandwidth(kbps);
      const quality = bitrateToQuality(kbps);
      if (quality !== currentQuality) {
        setCurrentQuality(quality);
        onQualityChange?.(quality);
      }
    },
    [currentQuality, onQualityChange]
  );

  const handleLoad = useCallback((_data: OnLoadData) => {
    setLoading(false);
    setError(null);
  }, []);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    setBuffering(isBuffering);
  }, []);

  const handleError = useCallback(
    (err: { error: { errorString: string } }) => {
      const msg = err.error?.errorString ?? 'Playback error';
      setError(msg);
      setLoading(false);
      onError?.(msg);
    },
    [onError]
  );

  const handleProgress = useCallback(
    (data: OnProgressData) => {
      onProgress?.(data);
    },
    [onProgress]
  );

  const togglePlay = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const selectedMaxBitrate = maxBitrateBps();

  return (
    <View style={[styles.container, style]}>
      <Video
        ref={videoRef}
        source={{ uri: source.uri, headers: source.headers, type: 'm3u8' }}
        style={styles.video}
        paused={paused}
        muted={muted}
        resizeMode="contain"
        poster={posterUri}
        posterResizeMode="cover"
        onLoad={handleLoad}
        onBuffer={handleBuffer}
        onError={handleError}
        onProgress={handleProgress}
        onBandwidthUpdate={handleBandwidthUpdate}
        // ExoPlayer-specific props (Android)
        bufferConfig={BUFFER_CONFIG}
        maxBitRate={selectedMaxBitrate}
        // HLS native on iOS via AVPlayer
        useTextureView={Platform.OS === 'android'}
        allowsExternalPlayback={false}
        ignoreSilentSwitch="ignore"
        playInBackground={false}
        playWhenInactive={false}
        reportBandwidth
      />

      {(loading || buffering) && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}

      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => setError(null)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.tapTarget} activeOpacity={1} onPress={togglePlay} />

      <View style={styles.qualityBadge} pointerEvents="none">
        <Text style={styles.qualityText}>
          {bandwidth !== null ? `${bandwidth} kbps · ${currentQuality}` : currentQuality}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    aspectRatio: 16 / 9,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  qualityBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  qualityText: {
    color: '#fff',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  retryButton: {
    backgroundColor: '#ffffff22',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default AdaptiveVideoPlayer;
