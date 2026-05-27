/**
 * Toast Context Provider
 * Manages global toast notification state and lifecycle
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ToastContextType, ToastMessage, ToastType } from '../types/toast';

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const generateId = useCallback(() => {
    return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType, duration: number = 3000): string => {
      const id = generateId();
      const toast: ToastMessage = {
        id,
        message,
        type,
        duration,
      };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          hideToast(id);
        }, duration);

        return id;
      }

      return id;
    },
    [generateId],
  );

  const showActionToast = useCallback(
    (
      message: string,
      type: ToastType,
      actionText: string,
      onAction: () => void,
      duration: number = 5000,
    ): string => {
      const id = generateId();
      const toast: ToastMessage = {
        id,
        message,
        type,
        duration,
        actionText,
        onAction,
      };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          hideToast(id);
        }, duration);

        return id;
      }

      return id;
    },
    [generateId],
  );

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const value: ToastContextType = {
    toasts,
    showToast,
    showActionToast,
    hideToast,
    clearAllToasts,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
