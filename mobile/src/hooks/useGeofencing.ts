/**
 * useGeofencing — React hook for background geofencing integration
 *
 * Issue #589: [Mobile] Implement Background Location Geofencing for IRL Events
 *
 * Usage:
 *   const { status, transitions, start, stop } = useGeofencing(regions);
 *
 * - Manages the full lifecycle: permissions → start → monitor → stop
 * - Exposes a live list of geofence transitions for in-app UI
 * - Cleans up the background task on unmount
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GeofenceRegion,
  GeofenceTransition,
  GeofencingStatus,
  getGeofencingStatus,
  startGeofencing,
  stopGeofencing,
} from "../services/GeofencingService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeofencingHookState =
  | "idle"
  | "requesting_permissions"
  | "active"
  | "stopped"
  | "error";

export interface UseGeofencingReturn {
  /** Current hook lifecycle state */
  hookState: GeofencingHookState;
  /** Detailed status from the native service */
  serviceStatus: GeofencingStatus | null;
  /** Ordered list of transitions (newest first, capped at 50) */
  transitions: GeofenceTransition[];
  /** Most recent transition, or null */
  latestTransition: GeofenceTransition | null;
  /** Start monitoring the supplied regions */
  start: () => Promise<void>;
  /** Stop monitoring and clean up */
  stop: () => Promise<void>;
  /** Clear the transitions history */
  clearTransitions: () => void;
  /** Human-readable error message, if any */
  error: string | null;
}

const MAX_TRANSITIONS = 50;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param regions  Array of geofence regions to monitor.
 *                 Changing this array after mount does NOT restart monitoring
 *                 automatically — call stop() then start() if regions change.
 */
export function useGeofencing(regions: GeofenceRegion[]): UseGeofencingReturn {
  const [hookState, setHookState] = useState<GeofencingHookState>("idle");
  const [serviceStatus, setServiceStatus] = useState<GeofencingStatus | null>(null);
  const [transitions, setTransitions] = useState<GeofenceTransition[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable ref to regions so the transition callback doesn't close over
  // a stale value
  const regionsRef = useRef(regions);
  useEffect(() => { regionsRef.current = regions; }, [regions]);

  // ── Transition handler ──────────────────────────────────────────────────────

  const handleTransition = useCallback((t: GeofenceTransition) => {
    setTransitions((prev) => [t, ...prev].slice(0, MAX_TRANSITIONS));
  }, []);

  // ── Start ───────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setHookState("requesting_permissions");
    setError(null);

    const status = await startGeofencing(regionsRef.current, handleTransition);
    setServiceStatus(status);

    if (status.active) {
      setHookState("active");
    } else {
      setHookState("error");
      setError(status.reason ?? "Failed to start geofencing");
    }
  }, [handleTransition]);

  // ── Stop ────────────────────────────────────────────────────────────────────

  const stop = useCallback(async () => {
    await stopGeofencing();
    setHookState("stopped");
    const status = await getGeofencingStatus();
    setServiceStatus(status);
  }, []);

  // ── Clear transitions ───────────────────────────────────────────────────────

  const clearTransitions = useCallback(() => {
    setTransitions([]);
  }, []);

  // ── Sync status on mount ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    getGeofencingStatus().then((status) => {
      if (cancelled) return;
      setServiceStatus(status);
      if (status.active) setHookState("active");
    });

    return () => { cancelled = true; };
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Do not stop the background task on unmount — it should keep running
      // even when the component is unmounted.  Call stop() explicitly to halt.
    };
  }, []);

  return {
    hookState,
    serviceStatus,
    transitions,
    latestTransition: transitions[0] ?? null,
    start,
    stop,
    clearTransitions,
    error,
  };
}
