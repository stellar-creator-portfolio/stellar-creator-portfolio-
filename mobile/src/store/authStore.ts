/**
 * Authentication store.
 *
 * Persisted with `zustand/middleware`'s `persist` using AsyncStorage as the
 * storage adapter. `isHydrated` starts `false` and flips to `true` once the
 * persisted state has been rehydrated, so the app can gate rendering until the
 * auth state is known. Only the durable fields (user/token/isAuthenticated) are
 * persisted — `isHydrated` is always derived at runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthState } from './types';

/** AsyncStorage key under which the auth store is persisted. */
export const AUTH_STORAGE_KEY = '@stellar/auth';

/**
 * Hook to access the authentication store.
 *
 * @example
 * const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isHydrated: false,
      setUser: (user, token) => set({ user, token, isAuthenticated: true }),
      clearAuth: () =>
        set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist the transient hydration flag.
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ isHydrated: true });
      },
    },
  ),
);
