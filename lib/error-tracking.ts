/**
 * Centralized error tracking module
 * Integrates with Sentry and custom backend logging endpoint
 * Replaces sessionStorage-based error logging with production-grade observability
 */

export interface ErrorContext {
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export interface ErrorReport {
  id: string;
  timestamp: string;
  level: "error" | "warning" | "info";
  message: string;
  stack?: string;
  context: ErrorContext;
  url?: string;
  userAgent?: string;
  environment?: string;
}

class ErrorTracker {
  private sessionId: string;
  private isInitialized = false;
  private enableTracking = true;

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  /**
   * Initialize error tracking with Sentry and backend endpoint
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.enableTracking =
      process.env.NEXT_PUBLIC_ENABLE_ERROR_TRACKING !== "false";

    if (!this.enableTracking) {
      console.log("[ErrorTracker] Error tracking disabled");
      return;
    }

    // Initialize Sentry on client-side
    if (typeof window !== "undefined") {
      await this.initializeSentry();
    }

    this.isInitialized = true;
  }

  /**
   * Initialize Sentry SDK
   */
  private async initializeSentry(): Promise<void> {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) {
      console.warn("[ErrorTracker] Sentry DSN not configured");
      return;
    }

    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn,
        environment:
          process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
        tracesSampleRate: 1.0,
        integrations: [
          new Sentry.Replay({
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],
        replaySessionSampleRate: 0.1,
        replayOnErrorSampleRate: 1.0,
      });
    } catch (error) {
      console.error("[ErrorTracker] Failed to initialize Sentry:", error);
    }
  }

  /**
   * Capture and report an error
   */
  async captureError(
    error: Error | string,
    context: ErrorContext = {},
  ): Promise<string> {
    if (!this.enableTracking) {
      console.error(
        "[ErrorTracker] Error tracking disabled, logging to console:",
        error,
      );
      return "";
    }

    const errorReport = this.buildErrorReport(error, context);

    // Send to Sentry
    await this.sendToSentry(error, context);

    // Send to backend logging endpoint
    await this.sendToBackend(errorReport);

    return errorReport.id;
  }

  /**
   * Capture a warning
   */
  async captureWarning(
    message: string,
    context: ErrorContext = {},
  ): Promise<string> {
    if (!this.enableTracking) {
      console.warn("[ErrorTracker] Warning:", message);
      return "";
    }

    const errorReport: ErrorReport = {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      level: "warning",
      message,
      context: { ...context, sessionId: this.sessionId },
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
    };

    await this.sendToBackend(errorReport);
    return errorReport.id;
  }

  /**
   * Build error report object
   */
  private buildErrorReport(
    error: Error | string,
    context: ErrorContext,
  ): ErrorReport {
    const errorObj = typeof error === "string" ? new Error(error) : error;

    return {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      level: "error",
      message: errorObj.message,
      stack: errorObj.stack,
      context: { ...context, sessionId: this.sessionId },
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
    };
  }

  /**
   * Send error to Sentry
   */
  private async sendToSentry(
    error: Error | string,
    context: ErrorContext,
  ): Promise<void> {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(error, {
        tags: {
          component: context.component,
          action: context.action,
        },
        contexts: {
          custom: context.metadata,
        },
        user: context.userId
          ? {
              id: context.userId,
              email: context.userEmail,
            }
          : undefined,
      });
    } catch (error) {
      console.error("[ErrorTracker] Failed to send to Sentry:", error);
    }
  }

  /**
   * Send error report to backend logging endpoint
   */
  private async sendToBackend(errorReport: ErrorReport): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("/api/errors/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(errorReport),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(
          "[ErrorTracker] Backend logging failed:",
          response.status,
          response.statusText,
        );
      }
    } catch (error) {
      console.error("[ErrorTracker] Failed to send error to backend:", error);
    }
  }

  /**
   * Set user context for error tracking
   */
  setUserContext(userId: string, userEmail?: string): void {
    try {
      const Sentry = require("@sentry/nextjs");
      Sentry.setUser({
        id: userId,
        email: userEmail,
      });
    } catch (error) {
      console.error("[ErrorTracker] Failed to set user context:", error);
    }
  }

  /**
   * Clear user context
   */
  clearUserContext(): void {
    try {
      const Sentry = require("@sentry/nextjs");
      Sentry.setUser(null);
    } catch (error) {
      console.error("[ErrorTracker] Failed to clear user context:", error);
    }
  }

  /**
   * Add breadcrumb for error tracking
   */
  addBreadcrumb(
    message: string,
    category: string = "user-action",
    level: "info" | "warning" | "error" = "info",
  ): void {
    try {
      const Sentry = require("@sentry/nextjs");
      Sentry.addBreadcrumb({
        message,
        category,
        level,
        timestamp: Date.now() / 1000,
      });
    } catch (error) {
      console.error("[ErrorTracker] Failed to add breadcrumb:", error);
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Export singleton instance
export const errorTracker = new ErrorTracker();

/**
 * Hook to initialize error tracking on app load
 */
export async function initializeErrorTracking(): Promise<void> {
  await errorTracker.initialize();
}
