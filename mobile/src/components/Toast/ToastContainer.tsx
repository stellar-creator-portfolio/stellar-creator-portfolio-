/**
 * Toast Container Component
 * Manages rendering of all active toast notifications globally
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useToast } from '../../context/ToastContext';
import { ToastNotification } from './ToastNotification';

export const ToastContainer: React.FC = () => {
  const { toasts, hideToast } = useToast();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast, index) => (
        <View
          key={toast.id}
          style={[
            styles.toastWrapper,
            {
              top: index * 80,
            },
          ]}
          pointerEvents="box-none"
        >
          <ToastNotification
            toast={toast}
            onDismiss={hideToast}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
    zIndex: 999,
  },
  toastWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
  },
});
