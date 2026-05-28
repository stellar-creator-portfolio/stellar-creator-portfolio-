/**
 * AppNavigator — root navigation tree.
 *
 * Uses transition presets from transitions.ts (Issue 2).
 * All screens are themed via useTheme() (Issue 3).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { DashboardScreen } from "../screens/DashboardScreen";
import { ThemeSettingsScreen } from "../screens/ThemeSettingsScreen";
import { OfflineScreen } from "../screens/OfflineScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { BiometricAuthScreen } from "../screens/BiometricAuthScreen";
import { useTheme } from "../theme/ThemeProvider";
import { ScreenTransitions, GestureConfig } from "./transitions";
import { RootStackParamList, MainTabParamList } from "../types";
import { FontSize, FontWeight } from "../theme/tokens";

// ─── Placeholder ──────────────────────────────────────────────────────────────

function Placeholder({ name }: { name: string }) {
  const { colors } = useTheme();
  return (
    <View style={[ph.c, { backgroundColor: colors.background }]}>
      <Text style={[ph.t, { color: colors.textSecondary }]}>{name}</Text>
    </View>
  );
}
const ph = StyleSheet.create({
  c: { flex: 1, alignItems: "center", justifyContent: "center" },
  t: { fontSize: FontSize.xl, fontWeight: FontWeight.semibold },
});

// ─── Navigators ───────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        },
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          fontWeight: FontWeight.medium,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>🏠</Text>
          ),
        }}
      >
        {() => <HomeScreen />}
      </Tab.Screen>

      <Tab.Screen
        name="Activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>⚡</Text>
          ),
        }}
      >
        {() => <Placeholder name="Activity" />}
      </Tab.Screen>

      <Tab.Screen
        name="Dashboard"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>📊</Text>
          ),
        }}
      >
        {() => <DashboardScreen />}
      </Tab.Screen>

      <Tab.Screen
        name="Profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>👤</Text>
          ),
        }}
      >
        {() => <Placeholder name="Profile" />}
      </Tab.Screen>

      <Tab.Screen
        name="Settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>⚙️</Text>
          ),
        }}
      >
        {() => <ThemeSettingsScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { isDark, colors } = useTheme();

  // Wire react-navigation theme to our dark mode state
  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.background,
          card: colors.surface,
          border: colors.border,
          text: colors.text,
          primary: colors.primary,
          notification: colors.error,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
          card: colors.surface,
          border: colors.border,
          text: colors.text,
          primary: colors.primary,
          notification: colors.error,
        },
      };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          ...GestureConfig,
        }}
      >
        <Stack.Screen
          name="MainTabs"
          component={MainTabs}
          options={{ animation: ScreenTransitions.MainTabs }}
        />
        <Stack.Screen
          name="Dashboard"
          options={{ animation: ScreenTransitions.Dashboard }}
        >
          {() => <DashboardScreen />}
        </Stack.Screen>
        <Stack.Screen
          name="LanguageSettings"
          options={{ animation: ScreenTransitions.LanguageSettings }}
        >
          {({ navigation }) => (
            <ThemeSettingsScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="BiometricAuth"
          component={BiometricAuthScreen}
          options={{ animation: ScreenTransitions.Dashboard }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
