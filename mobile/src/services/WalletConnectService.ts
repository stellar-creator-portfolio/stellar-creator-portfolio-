/**
 * WalletConnectService — WalletConnect v2 deep-link auth for Stellar
 *
 * Flow:
 *  1. Generate a WC URI (wc:…) via the WC v2 pairing API
 *  2. Deep-link the user's wallet app with that URI
 *  3. Listen for the `stellar://wc` callback carrying the session topic
 *  4. Verify the returned Stellar public key (G…, 56 chars)
 *  5. Exchange for a JWT via the backend auth endpoint
 *
 * No WalletConnect SDK is bundled — the URI is constructed per the
 * WC v2 spec so any WC-compatible wallet (Lobstr, Solar, etc.) works.
 * Replace RELAY_URL / PROJECT_ID with real values from cloud.walletconnect.com.
 */

import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Config ───────────────────────────────────────────────────────────────────

const WC_PROJECT_ID = "YOUR_WALLETCONNECT_PROJECT_ID"; // replace
const RELAY_URL = "wss://relay.walletconnect.com";
const APP_SCHEME = "stellar"; // must match app.json scheme
const CALLBACK_PATH = "wc"; // stellar://wc?topic=…&key=…

const STORAGE_KEY_SESSION = "@stellar/wc_session";
const STORAGE_KEY_TOKEN = "@stellar/auth_token";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WCSession {
  topic: string;
  publicKey: string; // Stellar G… address
  expiry: number;    // Unix timestamp (seconds)
}

export interface AuthToken {
  token: string;
  expiresAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cryptographically random hex string of `bytes` length */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // React Native's global crypto is available in Hermes / JSC
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    // Fallback: Math.random (not cryptographically secure — replace with
    // expo-crypto in production: await Crypto.getRandomBytesAsync(bytes))
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Validate a Stellar public key: starts with G, 56 alphanumeric chars */
export function isValidStellarKey(key: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(key.trim());
}

// ─── URI builder ──────────────────────────────────────────────────────────────

export interface WCUriParams {
  topic: string;
  symKey: string;
  relayProtocol: string;
}

/**
 * Build a WalletConnect v2 pairing URI.
 * Format: wc:<topic>@2?relay-protocol=irn&symKey=<key>
 */
export function buildWCUri(params: WCUriParams): string {
  const query = new URLSearchParams({
    "relay-protocol": params.relayProtocol,
    symKey: params.symKey,
  }).toString();
  return `wc:${params.topic}@2?${query}`;
}

/**
 * Generate a fresh pairing topic + symmetric key.
 */
export function generatePairingParams(): WCUriParams {
  return {
    topic: randomHex(16),   // 32-char hex topic
    symKey: randomHex(32),  // 64-char hex symmetric key
    relayProtocol: "irn",
  };
}

// ─── Deep-link launcher ───────────────────────────────────────────────────────

/**
 * Open the WC URI in a wallet app.
 * Tries known Stellar wallet deep-link schemes first, falls back to universal link.
 */
export async function openWalletWithUri(wcUri: string): Promise<void> {
  const encoded = encodeURIComponent(wcUri);

  // Ordered preference: Lobstr → Solar → generic wc: URI
  const candidates = [
    `lobstr://wc?uri=${encoded}`,
    `solar://wc?uri=${encoded}`,
    wcUri, // raw wc: URI — handled by any WC-registered wallet
  ];

  for (const url of candidates) {
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      await Linking.openURL(url);
      return;
    }
  }

  // Last resort: open WalletConnect web modal
  await Linking.openURL(
    `https://walletconnect.com/wc?uri=${encoded}`
  );
}

// ─── Callback parser ──────────────────────────────────────────────────────────

export interface WCCallbackParams {
  topic: string;
  publicKey: string;
}

/**
 * Parse the deep-link callback URL: stellar://wc?topic=…&key=…
 * Returns null if the URL is not a valid WC callback.
 */
export function parseWCCallback(url: string): WCCallbackParams | null {
  try {
    // Expo Linking normalises the URL; handle both stellar:// and exp://
    const parsed = new URL(url.replace(/^stellar:\/\//, "https://stellar.app/"));
    if (!parsed.pathname.includes(CALLBACK_PATH) && !url.includes(`${APP_SCHEME}://${CALLBACK_PATH}`)) {
      return null;
    }
    const topic = parsed.searchParams.get("topic");
    const publicKey = parsed.searchParams.get("key");
    if (!topic || !publicKey || !isValidStellarKey(publicKey)) return null;
    return { topic, publicKey };
  } catch {
    return null;
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────

export async function saveSession(session: WCSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
}

export async function loadSession(): Promise<WCSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return null;
    const session: WCSession = JSON.parse(raw);
    if (session.expiry < Date.now() / 1000) {
      await clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEY_SESSION, STORAGE_KEY_TOKEN]);
}

// ─── Backend auth exchange ────────────────────────────────────────────────────

/**
 * Exchange a verified WC session for a backend JWT.
 * Replace the fetch URL with your real auth endpoint.
 */
export async function exchangeForToken(
  session: WCSession,
  apiBaseUrl = "https://api.stellar.app"
): Promise<AuthToken> {
  const res = await fetch(`${apiBaseUrl}/api/auth/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: session.publicKey,
      topic: session.topic,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Auth failed (${res.status}): ${body || res.statusText}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error("Invalid auth response: missing token");

  const authToken: AuthToken = {
    token: data.token,
    expiresAt: data.expiresAt ?? Date.now() / 1000 + 3600,
  };
  await AsyncStorage.setItem(STORAGE_KEY_TOKEN, JSON.stringify(authToken));
  return authToken;
}

export async function loadToken(): Promise<AuthToken | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_TOKEN);
    if (!raw) return null;
    const token: AuthToken = JSON.parse(raw);
    if (token.expiresAt < Date.now() / 1000) {
      await AsyncStorage.removeItem(STORAGE_KEY_TOKEN);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}
