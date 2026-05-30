/**
 * Shared type definitions for the Zustand stores.
 *
 * All store state/action shapes live here so store files contain no inline
 * type definitions.
 */

/** Authenticated user profile persisted alongside the session token. */
export interface User {
  /** Stable unique identifier. */
  id: string;
  /** Account email address. */
  email: string;
  /** Optional human-readable display name. */
  displayName?: string;
  /** Optional avatar image URL. */
  avatarUrl?: string;
}

/** Authentication store state + actions. */
export interface AuthState {
  /** Current user, or `null` when signed out. */
  user: User | null;
  /** Current session token, or `null` when signed out. */
  token: string | null;
  /** Whether a user is currently authenticated. */
  isAuthenticated: boolean;
  /**
   * Whether the persisted store has finished rehydrating from storage.
   * Gate auth-dependent rendering on this to avoid a flash of the wrong screen.
   */
  isHydrated: boolean;
  /** Persist the signed-in user and token, marking the session authenticated. */
  setUser: (user: User, token: string) => void;
  /** Clear the user, token, and authenticated flag. */
  clearAuth: () => void;
}

/** Global UI store state + actions (in-memory only, never persisted). */
export interface UIState {
  /** Whether a global blocking loader should be shown. */
  isLoading: boolean;
  /** Current toast message, or `null` when no toast is visible. */
  toastMessage: string | null;
  /** Toggle the global loading flag. */
  setLoading: (value: boolean) => void;
  /** Show a toast with the given message. */
  showToast: (message: string) => void;
  /** Dismiss the current toast. */
  clearToast: () => void;
}
