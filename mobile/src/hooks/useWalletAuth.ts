/**
 * useWalletAuth — WalletConnect auth state machine
 *
 * States: idle → connecting → awaiting_wallet → verifying → authenticated | error
 *
 * - Generates WC pairing URI and opens wallet via deep link
 * - Listens for the stellar://wc callback via Expo Linking
 * - Validates the returned Stellar public key
 * - Exchanges for a backend JWT
 * - Persists session across app restarts
 * - Cleans up listeners on unmount
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import {
  buildWCUri,
  clearSession,
  exchangeForToken,
  generatePairingParams,
  isValidStellarKey,
  loadSession,
  loadToken,
  openWalletWithUri,
  parseWCCallback,
  saveSession,
  WCSession,
  AuthToken,
} from "../services/WalletConnectService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthStatus =
  | "idle"
  | "connecting"
  | "awaiting_wallet"
  | "verifying"
  | "authenticated"
  | "error";

export interface WalletAuthState {
  status: AuthStatus;
  session: WCSession | null;
  token: AuthToken | null;
  error: string | null;
  wcUri: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWalletAuth() {
  const [state, setState] = useState<WalletAuthState>({
    status: "idle",
    session: null,
    token: null,
    error: null,
    wcUri: null,
  });

  const isMountedRef = useRef(true);
  const pendingTopicRef = useRef<string | null>(null);

  // ── Restore persisted session on mount ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [session, token] = await Promise.all([loadSession(), loadToken()]);
      if (!isMountedRef.current) return;
      if (session && token) {
        setState((s) => ({ ...s, status: "authenticated", session, token }));
      }
    })();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Deep-link listener ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (!isMountedRef.current) return;

      const params = parseWCCallback(url);
      if (!params) return;

      // Only handle the callback for the pairing we initiated
      if (pendingTopicRef.current && params.topic !== pendingTopicRef.current) return;

      if (!isValidStellarKey(params.publicKey)) {
        setState((s) => ({
          ...s,
          status: "error",
          error: "Wallet returned an invalid Stellar public key.",
        }));
        return;
      }

      setState((s) => ({ ...s, status: "verifying", error: null }));

      const session: WCSession = {
        topic: params.topic,
        publicKey: params.publicKey,
        expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7 days
      };

      try {
        await saveSession(session);
        const token = await exchangeForToken(session);
        if (!isMountedRef.current) return;
        pendingTopicRef.current = null;
        setState((s) => ({ ...s, status: "authenticated", session, token, wcUri: null }));
      } catch (err) {
        if (!isMountedRef.current) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Authentication failed.",
        }));
      }
    };

    const sub = Linking.addEventListener("url", handleUrl);

    // Handle cold-start deep link (app was not running)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    return () => sub.remove();
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!isMountedRef.current) return;
    setState((s) => ({ ...s, status: "connecting", error: null, wcUri: null }));

    try {
      const params = generatePairingParams();
      const uri = buildWCUri(params);
      pendingTopicRef.current = params.topic;

      setState((s) => ({ ...s, status: "awaiting_wallet", wcUri: uri }));
      await openWalletWithUri(uri);
    } catch (err) {
      if (!isMountedRef.current) return;
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to open wallet.",
      }));
    }
  }, []);

  // ── Disconnect ───────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    pendingTopicRef.current = null;
    await clearSession();
    if (!isMountedRef.current) return;
    setState({ status: "idle", session: null, token: null, error: null, wcUri: null });
  }, []);

  // ── Reset error ──────────────────────────────────────────────────────────────
  const resetError = useCallback(() => {
    setState((s) => ({ ...s, status: "idle", error: null }));
  }, []);

  return { ...state, connect, disconnect, resetError };
}
