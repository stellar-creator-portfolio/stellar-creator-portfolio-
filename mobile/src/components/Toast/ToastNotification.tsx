/**
 * Toast Notification Component
 * Standard layout toast notification with support for success, error, info, and warning types
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToastMessage, ToastType } from '../types/toast';

interface ToastNotificationProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const getToastStyles = (type: ToastType) => {
  const baseStyles = {
    success: {
      backgroundColor: '#10b981',
      borderColor: '#059669',
      textColor: '#ffffff',
      icon: 'checkmark-circle' as const,
    },
    error: {
      backgroundColor: '#ef4444',
      borderColor: '#dc2626',
      textColor: '#ffffff',
      icon: 'close-circle' as const,
    },
    warning: {
      backgroundColor: '#f59e0b',
      borderColor: '#d97706',
      textColor: '#ffffff',
      icon: 'warning' as const,
    },
    info: {
      backgroundColor: '#3b82f6',
      borderColor: '#2563eb',
      textColor: '#ffffff',
      icon: 'information-circle' as const,
    },
  };

  return baseStyles[type];
};

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  toast,
  onDismiss,
}) => {
  const toastStyles = getToastStyles(toast.type);
  const slideAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    return () => {
      slideAnim.setValue(0);
    };
  }, [slideAnim]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 0],
  });

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        style={[
          styles.toast,
          {
            backgroundColor: toastStyles.backgroundColor,
            borderColor: toastStyles.borderColor,
          },
        ]}
      >
        <View style={styles.contentContainer}>
          <Ionicons
            name={toastStyles.icon}
            size={20}
            color={toastStyles.textColor}
            style={styles.icon}
          />
          <Text
            style={[styles.messageText, { color: toastStyles.textColor }]}
            numberOfLines={2}
          >
            {toast.message}
          </Text>
        </View>

        {toast.actionText && toast.onAction ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              toast.onAction?.();
              onDismiss(toast.id);
            }}
          >
            <Text style={[styles.actionText, { color: toastStyles.textColor }]}>
              {toast.actionText}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => onDismiss(toast.id)}
          >
            <Ionicons
              name="close"
              size={18}
              color={toastStyles.textColor}
            />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 8,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  icon: {
    marginRight: 12,
  },
  messageText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
});
