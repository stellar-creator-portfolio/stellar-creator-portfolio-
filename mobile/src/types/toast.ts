/**
 * Toast Notification Types
 * Defines all toast-related type definitions for the mobile application
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  actionText?: string;
  onAction?: () => void;
}

export interface ToastContextType {
  toasts: ToastMessage[];
  showToast: (message: string, type: ToastType, duration?: number) => string;
  showActionToast: (message: string, type: ToastType, actionText: string, onAction: () => void, duration?: number) => string;
  hideToast: (id: string) => void;
  clearAllToasts: () => void;
}
