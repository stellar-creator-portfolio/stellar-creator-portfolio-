'use client';

/**
 * PWA Utilities
 * Handles service worker registration, installation prompts, and push notifications
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaConfig {
  swPath?: string;
  enableNotifications?: boolean;
  vapidPublicKey?: string;
  cacheVersion?: string;
}

class PWAManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private config: Required<PwaConfig>;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

  constructor(config: PwaConfig = {}) {
    this.config = {
      swPath: config.swPath || '/sw.js',
      enableNotifications: config.enableNotifications ?? true,
      vapidPublicKey: config.vapidPublicKey || '',
      cacheVersion: config.cacheVersion || 'v1',
    };

    this.init();
  }

  /**
   * Initialize PWA features
   */
  private async init(): Promise<void> {
    if (!this.isSupported()) {
      console.warn('[PWA] Service Workers not supported in this browser');
      return;
    }

    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.handleAppVisibility();
    this.monitorNetworkStatus();
  }

  /**
   * Check if PWA features are supported
   */
  private isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'caches' in window
    );
  }

  /**
   * Register service worker
   */
  private async registerServiceWorker(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) {
        throw new Error('Service Workers not supported');
      }

      const registration = await navigator.serviceWorker.register(
        this.config.swPath,
        {
          scope: '/',
          updateViaCache: 'none',
        }
      );

      this.serviceWorkerRegistration = registration;
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data === "SW_ACTIVATED") clearStaleMutations();
      });

      console.log('[PWA] Service Worker registered:', registration);

      // Check for updates periodically
      setInterval(() => {
        registration.update().catch((error) => {
          console.error('[PWA] Service Worker update check failed:', error);
        });
      }, 60000); // Check every minute

      // Listen for service worker updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            // New service worker available
            this.notifyUpdate();
          }
        });
      });
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
    }
  }

  /**
   * Setup install prompt handler
   */
  private setupInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.showInstallPrompt();
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App installed');
      this.deferredPrompt = null;
      this.hideInstallPrompt();
      this.trackEvent('app-installed');
    });
  }

  /**
   * Show install prompt (can be called by UI)
   */
  public async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) {
      console.log('[PWA] Install prompt not available');
      return false;
    }

    try {
      await this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      console.log('[PWA] Install prompt outcome:', outcome);
      this.trackEvent('install-prompt-response', { outcome });
      return outcome === 'accepted';
    } catch (error) {
      console.error('[PWA] Install prompt failed:', error);
      return false;
    }
  }

  /**
   * Check if app is installable
   */
  public isInstallPromptAvailable(): boolean {
    return this.deferredPrompt !== null;
  }

  /**
   * Check if app is running as PWA
   */
  public isRunningAsApp(): boolean {
    if (typeof window === 'undefined') return false;

    return (
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    );
  }

  /**
   * Request notification permission
   */
  public async requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('[PWA] Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('[PWA] Notification permission denied');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      const granted = permission === 'granted';
      this.trackEvent('notification-permission', { granted });
      return granted;
    } catch (error) {
      console.error('[PWA] Notification permission request failed:', error);
      return false;
    }
  }

  /**
   * Subscribe to push notifications
   */
  public async subscribeToPushNotifications(): Promise<PushSubscription | null> {
    if (!this.config.enableNotifications || !this.serviceWorkerRegistration) {
      console.warn('[PWA] Push notifications not available');
      return null;
    }

    try {
      const permission = await this.requestNotificationPermission();
      if (!permission) {
        return null;
      }

      const subscription =
        await this.serviceWorkerRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.config.vapidPublicKey,
        });

      console.log('[PWA] Subscribed to push notifications:', subscription);
      this.trackEvent('push-subscribed');

      // Send subscription to backend
      await this.sendSubscriptionToBackend(subscription);

      return subscription;
    } catch (error) {
      console.error('[PWA] Push subscription failed:', error);
      return null;
    }
  }

  /**
   * Send push subscription to backend
   */
  private async sendSubscriptionToBackend(
    subscription: PushSubscription
  ): Promise<void> {
    try {
      await fetch('/api/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
    } catch (error) {
      console.error('[PWA] Failed to send subscription to backend:', error);
    }
  }

  /**
   * Send local notification
   */
  public async sendNotification(
    title: string,
    options?: NotificationOptions
  ): Promise<void> {
    if (!this.serviceWorkerRegistration) {
      console.warn('[PWA] Service Worker not registered');
      return;
    }

    try {
      await this.serviceWorkerRegistration.showNotification(title, {
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        ...options,
      });
    } catch (error) {
      console.error('[PWA] Failed to send notification:', error);
    }
  }

  /**
   * Handle app visibility changes
   */
  private handleAppVisibility(): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('[PWA] App became visible');
        this.trackEvent('app-visible');
      }
    });
  }

  /**
   * Monitor network status
   */
  private monitorNetworkStatus(): void {
    window.addEventListener('online', () => {
      console.log('[PWA] App is online');
      this.notifyNetworkStatusChange(true);
      this.trackEvent('network-online');
    });

    window.addEventListener('offline', () => {
      console.log('[PWA] App is offline');
      this.notifyNetworkStatusChange(false);
      this.trackEvent('network-offline');
    });
  }

  /**
   * Get network status
   */
  public isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * Notify UI of network status change
   */
  private notifyNetworkStatusChange(isOnline: boolean): void {
    const event = new CustomEvent('pwa-network-status', {
      detail: { isOnline },
    });
    window.dispatchEvent(event);
  }

  /**
   * Notify UI of service worker update
   */
  private notifyUpdate(): void {
    const event = new CustomEvent('pwa-update-available');
    window.dispatchEvent(event);
  }

  /**
   * Show install prompt UI (to be implemented by app)
   */
  private showInstallPrompt(): void {
    const event = new CustomEvent('pwa-install-prompt-available');
    window.dispatchEvent(event);
  }

  /**
   * Hide install prompt UI (to be implemented by app)
   */
  private hideInstallPrompt(): void {
    const event = new CustomEvent('pwa-install-prompt-hidden');
    window.dispatchEvent(event);
  }

  /**
   * Track PWA events for analytics
   */
  private trackEvent(eventName: string, data?: Record<string, any>): void {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', `pwa_${eventName}`, data);
    }
    console.log(`[PWA] Event: ${eventName}`, data);
  }

  /**
   * Unregister service worker (for cleanup)
   */
  public async unregisterServiceWorker(): Promise<void> {
    if (!this.serviceWorkerRegistration) return;

    try {
      await this.serviceWorkerRegistration.unregister();
      this.serviceWorkerRegistration = null;
      console.log('[PWA] Service Worker unregistered');
    } catch (error) {
      console.error('[PWA] Failed to unregister Service Worker:', error);
    }
  }

  /**
   * Clear all caches
   */
  public async clearAllCaches(): Promise<void> {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      console.log('[PWA] All caches cleared');
      this.trackEvent('caches-cleared');
    } catch (error) {
      console.error('[PWA] Failed to clear caches:', error);
    }
  }

  /**
   * Get cache storage usage
   */
  public async getCacheStorageUsage(): Promise<{
    usage: number;
    quota: number;
    percentage: number;
  } | null> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
        percentage: ((estimate.usage || 0) / (estimate.quota || 1)) * 100,
      };
    } catch (error) {
      console.error('[PWA] Failed to get cache storage usage:', error);
      return null;
    }
  }

  /**
   * Request persistent storage
   */
  public async requestPersistentStorage(): Promise<boolean> {
    if (!('storage' in navigator) || !('persist' in navigator.storage)) {
      return false;
    }

    try {
      const isPersisted = await navigator.storage.persist();
      console.log('[PWA] Persistent storage granted:', isPersisted);
      this.trackEvent('persistent-storage-granted', { isPersisted });
      return isPersisted;
    } catch (error) {
      console.error('[PWA] Failed to request persistent storage:', error);
      return false;
    }
  }
}

// Export singleton instance
export const pwa = new PWAManager({
  swPath: '/sw.js',
  enableNotifications: true,
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});

// Export manager class for custom initialization
export default PWAManager;
