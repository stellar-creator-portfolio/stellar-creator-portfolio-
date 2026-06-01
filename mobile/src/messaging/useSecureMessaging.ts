/**
 * messaging/useSecureMessaging.ts
 *
 * React hook that wraps SignalSessionManager for use in a chat UI.
 * Handles session establishment, send, receive, and key rotation on mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalSessionManager } from './signal-session';
import type { DecryptedMessage, EncryptedMessage, KeyBundle } from '../types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.stellar.dev';

interface UseSecureMessagingOptions {
  localUserId: string;
  remoteUserId: string;
}

interface UseSecureMessagingResult {
  messages:  DecryptedMessage[];
  send:      (text: string) => Promise<void>;
  loading:   boolean;
  error:     string | null;
}

export function useSecureMessaging({
  localUserId,
  remoteUserId,
}: UseSecureMessagingOptions): UseSecureMessagingResult {
  const manager  = useRef(new SignalSessionManager());
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // ── Bootstrap: establish session + rotate keys ─────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        // Fetch remote user's key bundle from server
        const res = await fetch(`${API_BASE}/api/users/${remoteUserId}/key-bundle`);
        if (!res.ok) throw new Error('Failed to fetch key bundle');
        const bundle: KeyBundle = await res.json();

        await manager.current.establishSession(remoteUserId, bundle);

        // Rotate local keys if needed and upload updated bundle
        const newBundle = await manager.current.rotateKeysIfNeeded();
        if (newBundle) {
          await fetch(`${API_BASE}/api/users/${localUserId}/key-bundle`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(newBundle),
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Session init failed');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [localUserId, remoteUserId]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const send = useCallback(async (text: string) => {
    try {
      const encrypted = await manager.current.encrypt(remoteUserId, text);
      await fetch(`${API_BASE}/api/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          recipientId: encrypted.recipientId,
          ciphertext:  Buffer.from(encrypted.ciphertext).toString('base64'),
          messageType: encrypted.messageType,
          timestamp:   encrypted.timestamp,
        }),
      });
      // Optimistic local append (we know the plaintext)
      setMessages((prev) => [
        ...prev,
        { id: encrypted.id, senderId: localUserId, body: text, timestamp: encrypted.timestamp },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    }
  }, [localUserId, remoteUserId]);

  // ── Receive (poll — replace with WebSocket in production) ─────────────────

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/messages?from=${remoteUserId}`);
        if (!res.ok) return;
        const { messages: incoming }: { messages: EncryptedMessage[] } = await res.json();
        const decrypted = await Promise.all(
          incoming.map((m) => manager.current.decrypt(m)),
        );
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...decrypted.filter((m) => !ids.has(m.id))];
        });
      } catch { /* silent — network may be unavailable */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [loading, remoteUserId]);

  return { messages, send, loading, error };
}
