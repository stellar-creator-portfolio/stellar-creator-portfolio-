#!/bin/bash

# Quick setup script to create PR for mobile features implementation
# Run this script to commit changes and create the PR

set -e

echo "🚀 Starting mobile features PR creation..."

# Get current directory
REPO_DIR="$(pwd)"
echo "📁 Working directory: $REPO_DIR"

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install git first."
    exit 1
fi

# Check if we're in a git repository
if [ ! -d .git ]; then
    echo "❌ Not in a git repository. Please run this from the repository root."
    exit 1
fi

echo "✅ Git repository found"

# Create new branch
echo "🌿 Creating new branch: mobile/multi-feature-implementation"
git checkout -b mobile/multi-feature-implementation 2>/dev/null || {
    echo "⚠️  Branch might already exist, checking it out..."
    git checkout mobile/multi-feature-implementation
}

# Stage all changes
echo "📦 Staging changes..."
git add -A

# Check if there are any changes
if git diff --cached --quiet; then
    echo "⚠️  No changes to commit. All files might already be committed."
else
    echo "✅ Changes staged"
    
    # Create commit with detailed message
    echo "💾 Creating commit..."
    git commit -m "Mobile: Implement Toast notifications, Keyboard avoidance, Distribution mappings, and Sentry crash tracking

This comprehensive commit addresses four critical mobile functionality issues with detailed implementations:

## Closes #561 [Mobile] Integrate explicit distinct standard layout Toast notifications accurately globally

**Implementation Details:**
- Created mobile/src/types/toast.ts - Toast notification type definitions with support for success, error, warning, and info types
- Created mobile/src/context/ToastContext.tsx - Global toast state management using React Context with lifecycle management
- Created mobile/src/components/Toast/ToastNotification.tsx - Standard layout toast component with smooth animations using React Native Animated API
- Created mobile/src/components/Toast/ToastContainer.tsx - Global toast container for rendering multiple stacked notifications with proper z-index management
- Integrated ToastProvider in mobile/src/index.tsx and added ToastContainer to render toasts globally
- Features: Multiple simultaneous toasts, auto-dismiss with configurable duration, action buttons, type-specific styling and icons

## Closes #560 [Mobile] Manage comprehensive exact localized Keyboard avoidance behavioral anomalies precisely

**Implementation Details:**
- Created mobile/src/hooks/useKeyboardAvoidance.ts - Custom hook for keyboard detection and position tracking with platform-specific behavior
- Created mobile/src/components/KeyboardAvoidance/KeyboardAvoidingContainer.tsx - Animated view component that automatically adjusts layout when keyboard appears
- Features: Platform-specific keyboard event handling (iOS keyboard will/did show, Android keyboard did show), smooth animated transitions, configurable offset positioning
- Prevents keyboard from covering input fields and maintains proper UI layout across iOS and Android

## Closes #565 [Mobile] Provide specific distinct exact production release distribution specific mappings definitively

**Implementation Details:**
- Created mobile/src/config/distributionMappings.ts - Environment-specific distribution configurations with support for development, staging, beta, and production environments
- Created mobile/src/config/DistributionConfigManager.ts - Singleton configuration manager for centralized distribution settings management
- Features: Platform-specific configurations (iOS and Android), environment-specific API endpoints, Sentry DSN mappings, timeouts and retry configurations, debug and analytics toggles
- Supports seamless switching between development, staging, beta, and production environments with appropriate settings for each

## Closes #564 [Mobile] Construct specific distinct exact crash tracking Sentry specific metrics thoroughly

**Implementation Details:**
- Created mobile/src/types/sentry.ts - Type definitions for error tracking including CrashMetrics, BreadcrumbData, PerformanceMetrics, and SentryConfig
- Created mobile/src/services/SentryErrorTracker.ts - Comprehensive singleton error tracking service with exception, message, and performance metrics capture
- Created mobile/src/hooks/useErrorTracking.ts - Custom hook for component-level error tracking with automatic screen name attachment and breadcrumb tracking
- Features: Exception capture with stack traces, message capture with severity levels, breadcrumb trail tracking, performance metrics tracking, user context management, configurable debug mode

**Integration:**
- Updated mobile/src/index.tsx to initialize DistributionConfigManager with platform detection and SentryErrorTracker with configuration from distribution manager
- Wrapped app with ToastProvider for global toast capabilities
- Mounted ToastContainer for rendering notifications globally at root level

**Files Created/Modified:**
- mobile/src/index.tsx (modified)
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
- mobile/src/services/SentryErrorTracker.ts (new)"
fi

# Push to remote
echo "🔄 Pushing to remote..."
git push -u origin mobile/multi-feature-implementation

echo "✅ Branch created and pushed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Go to: https://github.com/yosemite01/stellar-creator-portfolio/compare/main...mobile/multi-feature-implementation"
echo "2. Click 'Create Pull Request'"
echo "3. The commit message details will be auto-populated"
echo ""
echo "✨ All done!"
