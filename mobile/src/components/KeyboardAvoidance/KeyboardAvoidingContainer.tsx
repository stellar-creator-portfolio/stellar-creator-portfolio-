/**
 * Keyboard Avoiding View Component
 * Automatically adjusts view position when keyboard appears
 */

import React, { useMemo } from 'react';
import {
  Animated,
  View,
  ViewProps,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useKeyboardAvoidance } from '../hooks/useKeyboardAvoidance';

interface KeyboardAvoidingContainerProps extends ViewProps {
  children: React.ReactNode;
  offset?: number;
}

export const KeyboardAvoidingContainer: React.FC<KeyboardAvoidingContainerProps> = ({
  children,
  offset = 20,
  style,
  ...props
}) => {
  const { animatedValue, isVisible } = useKeyboardAvoidance();

  const animatedStyle = useMemo(
    () => ({
      transform: [{ translateY: animatedValue }],
    }),
    [animatedValue],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Animated.View
        style={[
          styles.content,
          animatedStyle,
          style,
        ]}
        {...props}
      >
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
