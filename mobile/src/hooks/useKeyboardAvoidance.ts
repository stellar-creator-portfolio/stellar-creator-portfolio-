/**
 * Keyboard Avoidance Hook
 * Manages keyboard visibility and position to prevent content overlap
 */

import { useEffect, useState, useRef } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  Animated,
  Platform,
} from 'react-native';

export interface KeyboardMetrics {
  isVisible: boolean;
  height: number;
  animatedValue: Animated.Value;
}

export const useKeyboardAvoidance = (offset: number = 0): KeyboardMetrics => {
  const [isVisible, setIsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const animatedValueRef = useRef(new Animated.Value(0));

  const animatedValue = animatedValueRef.current;

  useEffect(() => {
    const keyboardWillShow = (e: KeyboardEvent) => {
      const nextKeyboardHeight = e.endCoordinates.height;
      setKeyboardHeight(nextKeyboardHeight);
      setIsVisible(true);

      Animated.timing(animatedValue, {
        toValue: -(Math.max(nextKeyboardHeight - offset, 0)),
        duration: e.duration || 250,
        useNativeDriver: false,
      }).start();
    };

    const keyboardWillHide = (e: KeyboardEvent) => {
      setIsVisible(false);
      setKeyboardHeight(0);

      Animated.timing(animatedValue, {
        toValue: 0,
        duration: e.duration || 250,
        useNativeDriver: false,
      }).start();
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, keyboardWillShow);
    const hideSubscription = Keyboard.addListener(hideEvent, keyboardWillHide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [animatedValue, offset]);

  return {
    isVisible,
    height: keyboardHeight,
    animatedValue,
  };
};

export const useKeyboardAvoidancePosition = (
  baseOffset: number = 0,
): Animated.Value => {
  const { animatedValue } = useKeyboardAvoidance(baseOffset);

  return animatedValue;
};
