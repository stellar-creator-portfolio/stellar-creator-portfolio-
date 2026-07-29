/**
 * Keyboard Avoiding View Component
 * Automatically adjusts view position when keyboard appears
 */

import React from 'react';
import { Animated, ViewProps, StyleSheet } from 'react-native';
import { useKeyboardAvoidance } from '../../hooks/useKeyboardAvoidance';

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
  const { animatedValue } = useKeyboardAvoidance(offset);

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: animatedValue }] }, style]}
      {...props}
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
