/**
 * Global UI store (loading flag, toast message).
 *
 * In-memory only — intentionally NOT persisted.
 */
import { create } from 'zustand';
import type { UIState } from './types';

/**
 * Hook to access the global UI store.
 *
 * @example
 * const showToast = useUIStore((s) => s.showToast);
 */
export const useUIStore = create<UIState>((set) => ({
  isLoading: false,
  toastMessage: null,
  setLoading: (value) => set({ isLoading: value }),
  showToast: (message) => set({ toastMessage: message }),
  clearToast: () => set({ toastMessage: null }),
}));
