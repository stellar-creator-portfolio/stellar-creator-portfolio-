#!/usr/bin/env python3
"""
Git PR Creation Script for Mobile Features
Handles branch creation, commit, and PR push
"""

import subprocess
import sys
import os

def run_command(cmd, description):
    """Run a shell command and handle errors"""
    print(f"🔄 {description}...")
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd="/workspaces/stellar-creator-portfolio",
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"❌ Error: {result.stderr}")
            return False
        print(f"✅ {description} successful")
        return True
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

def main():
    print("🚀 Mobile Features PR Creation Script")
    print("=" * 50)
    
    os.chdir("/workspaces/stellar-creator-portfolio")
    
    # Create branch
    if not run_command(
        "git checkout -b mobile/multi-feature-implementation",
        "Creating branch"
    ):
        # Try checking out existing branch
        run_command(
            "git checkout mobile/multi-feature-implementation",
            "Switching to existing branch"
        )
    
    # Stage changes
    if not run_command("git add -A", "Staging changes"):
        return False
    
    # Create commit
    commit_message = '''Mobile: Implement Toast notifications, Keyboard avoidance, Distribution mappings, and Sentry crash tracking

This comprehensive commit addresses four critical mobile functionality issues:

## Closes #561 [Mobile] Integrate explicit distinct standard layout Toast notifications accurately globally

**Implementation Details:**
- Created mobile/src/types/toast.ts - Toast notification type definitions
- Created mobile/src/context/ToastContext.tsx - Global toast state management  
- Created mobile/src/components/Toast/ToastNotification.tsx - Toast component
- Created mobile/src/components/Toast/ToastContainer.tsx - Toast container
- Integrated ToastProvider and ToastContainer in mobile/src/index.tsx

## Closes #560 [Mobile] Manage comprehensive exact localized Keyboard avoidance behavioral anomalies precisely

**Implementation Details:**
- Created mobile/src/hooks/useKeyboardAvoidance.ts - Keyboard detection hook
- Created mobile/src/components/KeyboardAvoidance/KeyboardAvoidingContainer.tsx - Animated component

## Closes #565 [Mobile] Provide specific distinct exact production release distribution specific mappings definitively

**Implementation Details:**
- Created mobile/src/config/distributionMappings.ts - Distribution configurations
- Created mobile/src/config/DistributionConfigManager.ts - Configuration manager

## Closes #564 [Mobile] Construct specific distinct exact crash tracking Sentry specific metrics thoroughly

**Implementation Details:**
- Created mobile/src/types/sentry.ts - Error tracking types
- Created mobile/src/services/SentryErrorTracker.ts - Error tracking service
- Created mobile/src/hooks/useErrorTracking.ts - Error tracking hook
- Integrated SentryErrorTracker and configuration in mobile/src/index.tsx'''
    
    if not run_command(
        f'git commit -m "{commit_message}"',
        "Creating commit"
    ):
        print("⚠️  Commit creation failed or no changes to commit")
    
    # Push to remote
    if not run_command(
        "git push -u origin mobile/multi-feature-implementation",
        "Pushing to remote"
    ):
        return False
    
    print("\n✅ All operations completed successfully!")
    print("\n📝 PR Creation URL:")
    print("https://github.com/yosemite01/stellar-creator-portfolio/compare/main...mobile/multi-feature-implementation")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
