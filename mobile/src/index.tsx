/**
 * Mobile App Entry Point
 * Stellar Creator Portfolio Mobile Application
 */

import React, { useEffect } from 'react';
import { registerRootComponent, Platform } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from './theme/ThemeProvider';
import { NetworkProvider } from './offline/NetworkProvider';
import { AppNavigator } from './navigation/AppNavigator';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/Toast/ToastContainer';
import { SentryErrorTracker } from './services/SentryErrorTracker';
import { DistributionConfigManager, Platform as DistPlatform } from './config/DistributionConfigManager';

function App() {
  useEffect(() => {
    // Initialize distribution configuration
    const platformMapping: { [key: string]: DistPlatform } = {
      'ios': DistPlatform.IOS,
      'android': DistPlatform.ANDROID,
    };

    const configManager = DistributionConfigManager.initialize(
      platformMapping[Platform.OS] || DistPlatform.IOS,
    );

    // Initialize Sentry error tracking
    const sentryDsn = configManager.getSentryDsn();
    if (sentryDsn) {
      SentryErrorTracker.initialize({
        dsn: sentryDsn,
        enableDebug: configManager.isDebugEnabled(),
        environment: configManager.getReleaseChannel(),
        maxBreadcrumbs: 100,
        tracesSampleRate: 1.0,
      });
    }
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ToastProvider>
        <ThemeProvider>
          <NetworkProvider>
            <AppNavigator />
            <ToastContainer />
          </NetworkProvider>
        </ThemeProvider>
      </ToastProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

registerRootComponent(App);

export default App;
