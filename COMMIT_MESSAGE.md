Mobile: Implement Toast notifications, Keyboard avoidance, Distribution mappings, and Sentry crash tracking

This comprehensive commit addresses four critical mobile functionality issues with detailed implementations:

## Closes #561 [Mobile] Integrate explicit distinct standard layout Toast notifications accurately globally

**Implementation Details:**
- Created `mobile/src/types/toast.ts` - Toast notification type definitions with support for success, error, warning, and info types
- Created `mobile/src/context/ToastContext.tsx` - Global toast state management using React Context with lifecycle management
- Created `mobile/src/components/Toast/ToastNotification.tsx` - Standard layout toast component with smooth animations and native Expo animations
- Created `mobile/src/components/Toast/ToastContainer.tsx` - Global toast container for rendering multiple notifications with proper z-index management
- Integrated `ToastProvider` in `mobile/src/index.tsx` and added `ToastContainer` to render toasts globally
- Features: Multiple simultaneous toasts, auto-dismiss with configurable duration, action buttons, type-specific styling and icons

## Closes #560 [Mobile] Manage comprehensive exact localized Keyboard avoidance behavioral anomalies precisely

**Implementation Details:**
- Created `mobile/src/hooks/useKeyboardAvoidance.ts` - Custom hook for keyboard detection and position tracking with platform-specific behavior
- Created `mobile/src/components/KeyboardAvoidance/KeyboardAvoidingContainer.tsx` - Animated view component that automatically adjusts layout when keyboard appears
- Features: Platform-specific keyboard event handling (iOS keyboard will/did show, Android keyboard did show), smooth animated transitions, configurable offset positioning
- Prevents keyboard from covering input fields and maintains proper UI layout across iOS and Android

## Closes #565 [Mobile] Provide specific distinct exact production release distribution specific mappings definitively

**Implementation Details:**
- Created `mobile/src/config/distributionMappings.ts` - Environment-specific distribution configurations with support for development, staging, beta, and production
- Created `mobile/src/config/DistributionConfigManager.ts` - Singleton configuration manager for centralized distribution settings
- Features: Platform-specific configurations (iOS and Android), environment-specific API endpoints, Sentry DSN mappings, timeouts and retry configurations, debug and analytics toggles
- Supports seamless switching between development, staging, beta, and production environments with appropriate settings for each

## Closes #564 [Mobile] Construct specific distinct exact crash tracking Sentry specific metrics thoroughly

**Implementation Details:**
- Created `mobile/src/types/sentry.ts` - Type definitions for error tracking including CrashMetrics, BreadcrumbData, PerformanceMetrics
- Created `mobile/src/services/SentryErrorTracker.ts` - Comprehensive error tracking service with exception and message capture, breadcrumb tracking, performance metrics
- Created `mobile/src/hooks/useErrorTracking.ts` - Custom hook for component-level error tracking with automatic screen name attachment
- Features: Exception and message capture with context, breadcrumb trail for error navigation, performance metrics tracking (screen load time, API response time, JS execution time, memory usage), user context management, configurable debug mode

**Integration:**
- Updated `mobile/src/index.tsx` to:
  - Initialize DistributionConfigManager with platform detection
  - Initialize SentryErrorTracker with configuration from distribution manager
  - Wrap app with ToastProvider for global toast capabilities
  - Mount ToastContainer for rendering notifications globally

**Testing Recommendations:**
- Test Toast notifications on iOS and Android with different types and durations
- Verify keyboard avoidance with keyboard input fields on both platforms
- Validate distribution configuration loading for all environments
- Test error tracking and breadcrumb collection for various error scenarios

**Files Modified:**
- mobile/src/index.tsx
- mobile/src/types/toast.ts (new)
- mobile/src/types/sentry.ts (new)
- mobile/src/context/ToastContext.tsx (new)
- mobile/src/components/Toast/ToastNotification.tsx (new)
- mobile/src/components/Toast/ToastContainer.tsx (new)
- mobile/src/components/Toast/index.ts (new)
- mobile/src/components/KeyboardAvoidance/KeyboardAvoidingContainer.tsx (new)
- mobile/src/components/KeyboardAvoidance/index.ts (new)
- mobile/src/hooks/useKeyboardAvoidance.ts (new)
- mobile/src/hooks/useErrorTracking.ts (new)
- mobile/src/config/distributionMappings.ts (new)
- mobile/src/config/DistributionConfigManager.ts (new)
- mobile/src/services/SentryErrorTracker.ts (new)
