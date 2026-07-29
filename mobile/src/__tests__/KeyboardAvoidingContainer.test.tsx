/**
 * Static unit tests for {@link KeyboardAvoidingContainer}.
 *
 * The container should rely on the keyboard avoidance hook once, without an
 * extra native `KeyboardAvoidingView` wrapper that would double-shift iOS
 * layouts.
 */
import React from 'react';
import { KeyboardAvoidingView, Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockUseKeyboardAvoidance = jest.fn((offset: number = 20) => {
  const { Animated } = jest.requireActual('react-native');

  return {
    isVisible: true,
    height: 320,
    animatedValue: new Animated.Value(-(320 - offset)),
  };
});

jest.mock('../hooks/useKeyboardAvoidance', () => ({
  useKeyboardAvoidance: (offset?: number) => mockUseKeyboardAvoidance(offset),
}));

import { KeyboardAvoidingContainer } from '../components/KeyboardAvoidance';

describe('KeyboardAvoidingContainer', () => {
  beforeEach(() => {
    mockUseKeyboardAvoidance.mockClear();
  });

  it('passes the offset to the avoidance hook and does not render KeyboardAvoidingView', () => {
    const screen = render(
      <KeyboardAvoidingContainer offset={12} testID="keyboard-container">
        <Text>Composer</Text>
      </KeyboardAvoidingContainer>,
    ) as any;

    expect(mockUseKeyboardAvoidance).toHaveBeenCalledWith(12);
    expect(screen.UNSAFE_queryByType(KeyboardAvoidingView)).toBeNull();
    expect(screen.getByText('Composer')).toBeTruthy();
  });

  it('defaults the offset when none is provided', () => {
    render(
      <KeyboardAvoidingContainer>
        <Text>Default offset</Text>
      </KeyboardAvoidingContainer>,
    );

    expect(mockUseKeyboardAvoidance).toHaveBeenCalledWith(20);
  });
});
