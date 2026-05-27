/**
 * Error Tracking Hook
 * Provides error tracking capabilities to React components
 */

import { useCallback, useEffect } from 'react';
import { SentryErrorTracker } from '../services/SentryErrorTracker';
import { ErrorContext } from '../types/sentry';

export const useErrorTracking = (screenName?: string) => {
  const tracker = SentryErrorTracker.getInstance();

  useEffect(() => {
    if (screenName) {
      tracker.addBreadcrumb(`Navigated to ${screenName}`, 'navigation', 'info', {
        screen: screenName,
      });
    }
  }, [screenName, tracker]);

  const captureException = useCallback(
    (error: Error, context?: ErrorContext) => {
      const fullContext = {
        ...context,
        screen: screenName,
      };
      return tracker.captureException(error, fullContext);
    },
    [tracker, screenName],
  );

  const captureMessage = useCallback(
    (message: string, level?: 'info' | 'warning' | 'error') => {
      return tracker.captureMessage(message, level);
    },
    [tracker],
  );

  const trackAction = useCallback(
    (actionName: string, data?: Record<string, any>) => {
      tracker.addBreadcrumb(
        actionName,
        'action',
        'info',
        { ...data, screen: screenName },
      );
    },
    [tracker, screenName],
  );

  return {
    captureException,
    captureMessage,
    trackAction,
  };
};
