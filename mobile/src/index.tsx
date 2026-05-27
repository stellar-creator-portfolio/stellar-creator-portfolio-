/**
 * Mobile App Entry Point
 * Stellar Creator Portfolio Mobile Application
 */

import React from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from './theme/ThemeProvider';
import { NetworkProvider } from './offline/NetworkProvider';
import { AppNavigator } from './navigation/AppNavigator';

function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <NetworkProvider>
          <AppNavigator />
        </NetworkProvider>
      </ThemeProvider>
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
