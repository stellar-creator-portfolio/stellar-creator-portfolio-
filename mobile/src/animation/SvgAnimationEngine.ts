/**
 * Hardware-accelerated SVG animation engine built on react-native-reanimated.
 * All animation math runs on the UI thread via worklets — zero JS thread jank.
 *
 * Metal/Vulkan note:
 *   Reanimated's C++ worklet engine compiles down to platform-native UI thread
 *   operations on iOS (Metal-backed CALayer) and Android (Vulkan/GL RenderThread).
 */

import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  withDelay,
  cancelAnimation,
  Easing,
  runOnUI,
} from 'react-native-reanimated';
import { useCallback, useRef } from 'react';

export type AnimationPreset = 'pulse' | 'spin' | 'breathe' | 'bounce' | 'fadeIn';

export interface SvgAnimationConfig {
  preset: AnimationPreset;
  duration?: number;
  loop?: boolean;
  delay?: number;
  stiffness?: number;
}

export interface ParametricScaleConfig {
  minScale: number;
  maxScale: number;
  duration?: number;
}

function buildPulseAnimation(duration: number, loop: boolean): any {
  'worklet';
  const cycle = withSequence(
    withTiming(1.15, { duration: duration / 2 }),
    withTiming(1.0,  { duration: duration / 2 }),
  );
  return loop ? withRepeat(cycle, -1, false) : cycle;
}

function buildBreathAnimation(duration: number, loop: boolean): any {
  'worklet';
  const cycle = withSequence(
    withTiming(0.6, { duration: duration / 2, easing: Easing.inOut(Easing.ease) }),
    withTiming(1.0, { duration: duration / 2, easing: Easing.inOut(Easing.ease) }),
  );
  return loop ? withRepeat(cycle, -1, true) : cycle;
}

function buildSpinAnimation(duration: number, loop: boolean): any {
  'worklet';
  const cycle = withTiming(360, { duration, easing: Easing.linear });
  return loop ? withRepeat(cycle, -1, false) : cycle;
}

function buildFadeInAnimation(duration: number): any {
  'worklet';
  return withTiming(1.0, { duration, easing: Easing.out(Easing.quad) });
}

function buildBounceAnimation(duration: number, stiffness: number, loop: boolean): any {
  'worklet';
  const cycle = withSpring(1.0, { stiffness, damping: 10, mass: 1 });
  return loop ? withRepeat(cycle, -1, true) : cycle;
}

export function useSvgAnimation(config: SvgAnimationConfig) {
  const { preset, duration = 1000, loop = true, delay = 0, stiffness = 200 } = config;

  const scale    = useSharedValue(preset === 'bounce' ? 0.5 : 1.0);
  const opacity  = useSharedValue(preset === 'fadeIn' ? 0.0 : 1.0);
  const rotation = useSharedValue(0);
  const isPlaying = useRef(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotation.value}deg` }],
    opacity: opacity.value,
  }));

  const play = useCallback(() => {
    if (isPlaying.current) return;
    isPlaying.current = true;
    runOnUI(() => {
      'worklet';
      switch (preset) {
        case 'pulse':
          scale.value = delay > 0 ? withDelay(delay, buildPulseAnimation(duration, loop)) : buildPulseAnimation(duration, loop);
          break;
        case 'breathe':
          opacity.value = delay > 0 ? withDelay(delay, buildBreathAnimation(duration, loop)) : buildBreathAnimation(duration, loop);
          break;
        case 'spin':
          rotation.value = delay > 0 ? withDelay(delay, buildSpinAnimation(duration, loop)) : buildSpinAnimation(duration, loop);
          break;
        case 'fadeIn':
          opacity.value = delay > 0 ? withDelay(delay, buildFadeInAnimation(duration)) : buildFadeInAnimation(duration);
          break;
        case 'bounce':
          scale.value = delay > 0 ? withDelay(delay, buildBounceAnimation(duration, stiffness, loop)) : buildBounceAnimation(duration, stiffness, loop);
          break;
      }
    })();
  }, [preset, duration, loop, delay, stiffness, scale, opacity, rotation]);

  const stop = useCallback(() => {
    isPlaying.current = false;
    cancelAnimation(scale);
    cancelAnimation(opacity);
    cancelAnimation(rotation);
  }, [scale, opacity, rotation]);

  const reset = useCallback(() => {
    stop();
    scale.value = preset === 'bounce' ? 0.5 : 1.0;
    opacity.value = preset === 'fadeIn' ? 0.0 : 1.0;
    rotation.value = 0;
  }, [stop, scale, opacity, rotation, preset]);

  return { animatedStyle, play, stop, reset, scale, opacity, rotation };
}

export function useParametricAnimation(config: ParametricScaleConfig) {
  const { minScale, maxScale, duration = 300 } = config;
  const scale = useSharedValue(1.0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const scaleTo = useCallback(
    (target: number) => {
      const clamped = Math.max(minScale, Math.min(maxScale, target));
      scale.value = withTiming(clamped, { duration });
    },
    [scale, minScale, maxScale, duration],
  );

  return { animatedStyle, scaleTo, scale };
}
