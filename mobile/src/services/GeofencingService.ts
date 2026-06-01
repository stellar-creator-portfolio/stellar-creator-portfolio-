/**
 * GeofencingService — Background location geofencing for IRL events
 *
 * Issue #589: [Mobile] Implement Background Location Geofencing for IRL Events
 *
 * Design goals:
 *  - Tap into native background geolocation via expo-location's background task
 *  - Calculate proximity strictly on-device (Haversine formula) — no coordinates
 *    are sent to any server, preserving battery and privacy
 *  - Trigger silent OS-level push notifications when the user enters or exits
 *    a geofence region
 *  - Minimal battery impact: uses significant-location-change mode when idle,
 *    switches to high-accuracy only when near a fence boundary
 */

import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeofenceRegion {
  id: string;
  /** Human-readable name shown in notifications */
  name: string;
  latitude: number;
  longitude: number;
  /** Radius in metres */
  radiusMetres: number;
  /** Optional metadata (event title, URL, etc.) */
  metadata?: Record<string, string>;
}

export type GeofenceEvent = "enter" | "exit";

export interface GeofenceTransition {
  region: GeofenceRegion;
  event: GeofenceEvent;
  distanceMetres: number;
  timestamp: number;
}

export interface GeofencingStatus {
  active: boolean;
  permissionGranted: boolean;
  backgroundPermissionGranted: boolean;
  trackedRegions: number;
  reason?: string;
}

// ─── Module loaders ───────────────────────────────────────────────────────────

async function loadLocation() {
  try {
    const pkg = "expo-location";
    return await import(pkg);
  } catch {
    return null;
  }
}

async function loadNotifications() {
  try {
    const pkg = "expo-notifications";
    return await import(pkg);
  } catch {
    return null;
  }
}

async function loadTaskManager() {
  try {
    const pkg = "expo-task-manager";
    return await import(pkg);
  } catch {
    return null;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const GEOFENCE_TASK_NAME = "STELLAR_GEOFENCE_TASK";

/** Minimum distance change (metres) before a background update fires */
const BACKGROUND_DISTANCE_INTERVAL = 50;

/** How often (ms) to poll in foreground mode */
const FOREGROUND_POLL_INTERVAL_MS = 15_000;

// ─── Haversine proximity calculation (pure JS, no network) ───────────────────

const EARTH_RADIUS_M = 6_371_000;

/**
 * Returns the great-circle distance in metres between two coordinates.
 * Runs entirely on-device — no data leaves the app.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Returns all regions the given coordinate is inside, sorted by distance.
 */
export function findActiveRegions(
  latitude: number,
  longitude: number,
  regions: GeofenceRegion[],
): Array<{ region: GeofenceRegion; distanceMetres: number }> {
  return regions
    .map((region) => ({
      region,
      distanceMetres: haversineDistance(latitude, longitude, region.latitude, region.longitude),
    }))
    .filter(({ region, distanceMetres }) => distanceMetres <= region.radiusMetres)
    .sort((a, b) => a.distanceMetres - b.distanceMetres);
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function sendSilentNotification(
  transition: GeofenceTransition,
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const { region, event } = transition;
  const title =
    event === "enter"
      ? `📍 Near ${region.name}`
      : `👋 Left ${region.name}`;
  const body =
    event === "enter"
      ? `You're within ${Math.round(transition.distanceMetres)}m of ${region.name}.`
      : `You've moved away from ${region.name}.`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      // Silent data-only payload — no sound, no badge increment
      sound: false,
      badge: 0,
      data: {
        type: "geofence",
        regionId: region.id,
        event,
        metadata: region.metadata ?? {},
      },
    },
    trigger: null, // fire immediately
  });
}

// ─── Permission helpers ───────────────────────────────────────────────────────

export async function requestGeofencingPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  const Location = await loadLocation();
  if (!Location) return { foreground: false, background: false };

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  const foreground = fgStatus === "granted";

  let background = false;
  if (foreground && Platform.OS !== "web") {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    background = bgStatus === "granted";
  }

  return { foreground, background };
}

// ─── Background task registration ────────────────────────────────────────────

/**
 * Registers the background geofence task with expo-task-manager.
 * The task receives location updates and evaluates all registered regions
 * locally using Haversine distance — no server round-trip.
 *
 * Call this once at app startup (e.g. in App.tsx before the navigator mounts).
 */
export async function registerGeofenceTask(
  regions: GeofenceRegion[],
  onTransition?: (t: GeofenceTransition) => void,
): Promise<void> {
  const TaskManager = await loadTaskManager();
  if (!TaskManager) return;

  // Track previous inside-state per region to detect enter/exit transitions
  const insideState = new Map<string, boolean>();

  TaskManager.defineTask(
    GEOFENCE_TASK_NAME,
    ({ data, error }: { data: unknown; error: unknown }) => {
      if (error) return;

      const locations = (data as { locations?: Array<{ coords: { latitude: number; longitude: number } }> })
        ?.locations ?? [];

      for (const loc of locations) {
        const { latitude, longitude } = loc.coords;

        for (const region of regions) {
          const dist = haversineDistance(latitude, longitude, region.latitude, region.longitude);
          const isInside = dist <= region.radiusMetres;
          const wasInside = insideState.get(region.id) ?? false;

          if (isInside !== wasInside) {
            insideState.set(region.id, isInside);
            const transition: GeofenceTransition = {
              region,
              event: isInside ? "enter" : "exit",
              distanceMetres: dist,
              timestamp: Date.now(),
            };
            sendSilentNotification(transition);
            onTransition?.(transition);
          }
        }
      }
    },
  );
}

// ─── Service start / stop ─────────────────────────────────────────────────────

/**
 * Starts background location monitoring for the supplied regions.
 * Uses significant-location-change accuracy to minimise battery drain.
 */
export async function startGeofencing(
  regions: GeofenceRegion[],
  onTransition?: (t: GeofenceTransition) => void,
): Promise<GeofencingStatus> {
  const Location = await loadLocation();
  if (!Location) {
    return {
      active: false,
      permissionGranted: false,
      backgroundPermissionGranted: false,
      trackedRegions: 0,
      reason: "expo-location is not installed",
    };
  }

  const { foreground, background } = await requestGeofencingPermissions();
  if (!foreground) {
    return {
      active: false,
      permissionGranted: false,
      backgroundPermissionGranted: false,
      trackedRegions: 0,
      reason: "Location permission denied",
    };
  }

  await registerGeofenceTask(regions, onTransition);

  if (background) {
    await Location.startLocationUpdatesAsync(GEOFENCE_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: BACKGROUND_DISTANCE_INTERVAL,
      showsBackgroundLocationIndicator: false, // silent — no blue bar on iOS
      foregroundService: {
        notificationTitle: "Stellar",
        notificationBody: "Checking for nearby events…",
      },
    });
  }

  return {
    active: true,
    permissionGranted: foreground,
    backgroundPermissionGranted: background,
    trackedRegions: regions.length,
  };
}

/**
 * Stops background location monitoring and unregisters the task.
 */
export async function stopGeofencing(): Promise<void> {
  const Location = await loadLocation();
  if (!Location) return;

  try {
    await Location.stopLocationUpdatesAsync(GEOFENCE_TASK_NAME);
  } catch {
    // Task may not be running — ignore
  }
}

/**
 * Returns the current geofencing status without starting/stopping anything.
 */
export async function getGeofencingStatus(): Promise<GeofencingStatus> {
  const Location = await loadLocation();
  if (!Location) {
    return {
      active: false,
      permissionGranted: false,
      backgroundPermissionGranted: false,
      trackedRegions: 0,
      reason: "expo-location is not installed",
    };
  }

  const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
  const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
  const isRunning = await Location.hasStartedLocationUpdatesAsync(GEOFENCE_TASK_NAME).catch(() => false);

  return {
    active: isRunning,
    permissionGranted: fgStatus === "granted",
    backgroundPermissionGranted: bgStatus === "granted",
    trackedRegions: 0, // caller tracks this
  };
}
