/**
 * Sentry Error Tracking Types
 * Defines error tracking and crash metrics types
 */

export interface ErrorContext {
  userId?: string;
  screen?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export interface CrashMetrics {
  timestamp: number;
  errorId: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context: ErrorContext;
  severityLevel: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  breadcrumbs?: BreadcrumbData[];
}

export interface BreadcrumbData {
  timestamp: number;
  category: string;
  message: string;
  level: string;
  data?: Record<string, any>;
}

export interface PerformanceMetrics {
  screenLoadTime: number;
  apiResponseTime: number;
  jsExecutionTime: number;
  memoryUsage: number;
  cpuUsage?: number;
}

export interface SentryConfig {
  dsn: string;
  enableDebug: boolean;
  environment: string;
  maxBreadcrumbs: number;
  tracesSampleRate: number;
  initialScope?: Record<string, any>;
}
