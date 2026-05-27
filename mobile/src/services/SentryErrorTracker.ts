/**
 * Sentry Error Tracking Service
 * Handles crash tracking, error monitoring, and performance metrics
 */

import {
  ErrorContext,
  CrashMetrics,
  BreadcrumbData,
  PerformanceMetrics,
  SentryConfig,
} from '../types/sentry';

export class SentryErrorTracker {
  private static instance: SentryErrorTracker;
  private config: SentryConfig | null = null;
  private breadcrumbs: BreadcrumbData[] = [];
  private isInitialized: boolean = false;

  private constructor() {}

  /**
   * Initialize Sentry error tracking
   */
  public static initialize(config: SentryConfig): SentryErrorTracker {
    if (!SentryErrorTracker.instance) {
      SentryErrorTracker.instance = new SentryErrorTracker();
    }

    SentryErrorTracker.instance.config = config;
    SentryErrorTracker.instance.isInitialized = true;

    if (config.enableDebug) {
      console.log('[Sentry] Initialized with DSN:', config.dsn);
    }

    return SentryErrorTracker.instance;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SentryErrorTracker {
    if (!SentryErrorTracker.instance) {
      SentryErrorTracker.instance = new SentryErrorTracker();
    }
    return SentryErrorTracker.instance;
  }

  /**
   * Capture exception
   */
  public captureException(error: Error, context: ErrorContext = {}): string {
    if (!this.isInitialized) {
      console.warn('[Sentry] Not initialized, cannot capture exception');
      return '';
    }

    const errorId = this.generateErrorId();
    const metrics: CrashMetrics = {
      timestamp: Date.now(),
      errorId,
      errorType: error.name || 'Unknown',
      errorMessage: error.message,
      stackTrace: error.stack,
      context,
      severityLevel: 'error',
      breadcrumbs: this.getBreadcrumbs(),
    };

    if (this.config?.enableDebug) {
      console.log('[Sentry] Captured exception:', metrics);
    }

    // In a real implementation, this would send to Sentry API
    this.sendToSentry('exception', metrics);

    return errorId;
  }

  /**
   * Capture message
   */
  public captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): string {
    if (!this.isInitialized) {
      console.warn('[Sentry] Not initialized, cannot capture message');
      return '';
    }

    const errorId = this.generateErrorId();
    const metrics: CrashMetrics = {
      timestamp: Date.now(),
      errorId,
      errorType: 'Message',
      errorMessage: message,
      context: {},
      severityLevel: level,
      breadcrumbs: this.getBreadcrumbs(),
    };

    if (this.config?.enableDebug) {
      console.log('[Sentry] Captured message:', metrics);
    }

    this.sendToSentry('message', metrics);

    return errorId;
  }

  /**
   * Add breadcrumb
   */
  public addBreadcrumb(
    message: string,
    category: string = 'action',
    level: string = 'info',
    data?: Record<string, any>,
  ): void {
    if (!this.isInitialized) {
      return;
    }

    const breadcrumb: BreadcrumbData = {
      timestamp: Date.now(),
      category,
      message,
      level,
      data,
    };

    this.breadcrumbs.push(breadcrumb);

    // Keep only the last N breadcrumbs
    const maxBreadcrumbs = this.config?.maxBreadcrumbs || 100;
    if (this.breadcrumbs.length > maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-maxBreadcrumbs);
    }

    if (this.config?.enableDebug) {
      console.log('[Sentry] Added breadcrumb:', breadcrumb);
    }
  }

  /**
   * Clear breadcrumbs
   */
  public clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  /**
   * Capture performance metrics
   */
  public capturePerformanceMetrics(metrics: PerformanceMetrics): string {
    if (!this.isInitialized) {
      console.warn('[Sentry] Not initialized, cannot capture performance metrics');
      return '';
    }

    const errorId = this.generateErrorId();

    if (this.config?.enableDebug) {
      console.log('[Sentry] Performance metrics:', metrics);
    }

    this.sendToSentry('performance', {
      errorId,
      metrics,
      timestamp: Date.now(),
    });

    return errorId;
  }

  /**
   * Set user context
   */
  public setUserContext(userId: string, userData?: Record<string, any>): void {
    if (!this.isInitialized) {
      return;
    }

    if (this.config?.enableDebug) {
      console.log('[Sentry] Set user context:', userId);
    }

    // Update initial scope if available
    if (this.config?.initialScope) {
      this.config.initialScope.userId = userId;
      if (userData) {
        this.config.initialScope.userData = userData;
      }
    }
  }

  /**
   * Clear user context
   */
  public clearUserContext(): void {
    if (!this.isInitialized) {
      return;
    }

    if (this.config?.initialScope) {
      delete this.config.initialScope.userId;
      delete this.config.initialScope.userData;
    }
  }

  /**
   * Get breadcrumbs
   */
  private getBreadcrumbs(): BreadcrumbData[] {
    return [...this.breadcrumbs];
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `sentry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send data to Sentry (placeholder for actual implementation)
   */
  private sendToSentry(type: string, data: any): void {
    // This would be implemented with actual Sentry SDK integration
    if (this.config?.enableDebug) {
      console.log(`[Sentry] Would send ${type} to:`, this.config?.dsn);
    }
  }

  /**
   * Check if initialized
   */
  public isInitializedProperly(): boolean {
    return this.isInitialized && this.config !== null;
  }
}
