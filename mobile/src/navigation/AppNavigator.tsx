/**
 * AppNavigator — root navigation tree.
 *
 * Uses transition presets from transitions.ts.
 * All screens are themed via useTheme().
 * Deep-linking wired via LINKING_OPTIONS (Issue #543).
 *
 * Screens registered:
 *  - MainTabs (bottom tab navigator)
 *  - Dashboard
 *  - LanguageSettings
 *  - CreatorProfile   (Issue #542)
 *  - FreelancerDirectory (Issue #544)
 *  - FreelancerProfile   (Issue #544)
 *  - ImagePicker      (Issue #545)
 *  - Messaging
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackScreenProps } from "@react-navigation/native-stack";
import { createBottomTabNavigator, BottomTabScreenProps } from "@react-navigation/bottom-tabs";

import { DashboardScreen } from "../screens/DashboardScreen";
import { ThemeSettingsScreen } from "../screens/ThemeSettingsScreen";
import { PortfolioUploadScreen } from "../screens/PortfolioUploadScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { BiometricAuthScreen } from "../screens/BiometricAuthScreen";
import { CreatorProfileScreen } from "../screens/CreatorProfileScreen";
import { CreatorProfileScreenConnected } from "../screens/CreatorProfileScreenConnected";
import { FreelancerDirectoryScreen } from "../screens/FreelancerDirectoryScreen";
import { ImagePickerScreen } from "../screens/ImagePickerScreen";
import { ImageEditorScreen } from "../screens/ImageEditorScreen";
import { MessagingScreen } from "../screens/MessagingScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { DetailsView } from "../screens/DetailsView";
import { ActivityScreen } from "../screens/ActivityScreen";
import { useTheme } from "../theme/ThemeProvider";
import { ScreenTransitions, GestureConfig } from "./transitions";
import { RootStackParamList, MainTabParamList } from "../types";
import { FontSize, FontWeight } from "../theme/tokens";
import { LINKING_OPTIONS } from "../config/DeepLinkConfig";

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
          tabBarIcon: ({ color }: { color: string }) => (
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
          tabBarIcon: ({ color }: { color: string }) => (
            <Text style={{ fontSize: 20, color }}>⚡</Text>
          ),
        }}
      >
        {() => <ActivityScreen />}
      </Tab.Screen>

      <Tab.Screen
        name="Dashboard"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }: { color: string }) => (
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
          tabBarIcon: ({ color }: { color: string }) => (
            <Text style={{ fontSize: 20, color }}>👤</Text>
          ),
        }}
      >
        {() => <ProfileScreen />}
      </Tab.Screen>

      <Tab.Screen
        name="Settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }: { color: string }) => (
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
    <NavigationContainer theme={navTheme} linking={LINKING_OPTIONS}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          ...GestureConfig,
        }}
      >
        {/* ── Core tabs ─────────────────────────────────────────────────── */}
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
          name="DetailsView"
          options={{ animation: ScreenTransitions.Dashboard }}
        >
          {({ navigation }: NativeStackScreenProps<RootStackParamList, 'DetailsView'>) => (
            <DetailsView onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="LanguageSettings"
          options={{ animation: ScreenTransitions.LanguageSettings }}
        >
          {({ navigation }: NativeStackScreenProps<RootStackParamList, 'LanguageSettings'>) => (
            <ThemeSettingsScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="PortfolioUpload"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
          component={PortfolioUploadScreen}
        />

        {/* ── Issue #542 — Creator Native Profile ───────────────────────── */}
        <Stack.Screen
          name="CreatorProfile"
          options={{ animation: "slide_from_right" }}
        >
          {({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'CreatorProfile'>) => (
            <CreatorProfileScreen
              creatorId={route.params?.creatorId}
              onBack={() => navigation.goBack()}
              onMessage={(id) =>
                navigation.navigate("Messaging", {
                  conversationId: `conv-${id}`,
                  recipientName: "Creator",
                })
              }
            />
          )}
        </Stack.Screen>

        {/* ── Issue #544 — Freelancer Directory ─────────────────────────── */}
        <Stack.Screen
          name="FreelancerDirectory"
          options={{ animation: "slide_from_right" }}
        >
          {({ navigation }: NativeStackScreenProps<RootStackParamList, 'FreelancerDirectory'>) => (
            <FreelancerDirectoryScreen
              onBack={() => navigation.goBack()}
              onSelectFreelancer={(id) =>
                navigation.navigate("FreelancerProfile", { creatorId: id })
              }
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="FreelancerProfile"
          options={{ animation: "slide_from_right" }}
        >
          {({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'FreelancerProfile'>) => (
            <CreatorProfileScreen
              creatorId={route.params?.creatorId}
              onBack={() => navigation.goBack()}
              onMessage={(id) =>
                navigation.navigate("Messaging", {
                  conversationId: `conv-${id}`,
                  recipientName: "Freelancer",
                })
              }
            />
          )}
        </Stack.Screen>

        {/* ── Issue #545 — Image Picker ──────────────────────────────────── */}
        <Stack.Screen
          name="ImagePicker"
          options={{ animation: "slide_from_bottom" }}
        >
          {({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ImagePicker'>) => (
            <ImagePickerScreen
              maxImages={route.params?.maxImages ?? 10}
              onBack={() => navigation.goBack()}
              onUploadComplete={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>

        {/* ── Advanced Image Cropper & Filters ───────────────────────────── */}
        <Stack.Screen
          name="ImageEditor"
          options={{ animation: "slide_from_bottom" }}
        >
          {({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ImageEditor'>) => (
            <ImageEditorScreen
              imageUri={route.params?.imageUri}
              imageWidth={route.params?.imageWidth}
              imageHeight={route.params?.imageHeight}
              fileSize={route.params?.fileSize}
              mode={route.params?.mode ?? "avatar"}
              onBack={() => navigation.goBack()}
              onComplete={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>

        {/* ── Messaging (used by deep-link + creator profile CTA) ───────── */}
        <Stack.Screen
          name="Messaging"
          options={{ animation: "slide_from_right" }}
        >
          {({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Messaging'>) => (
            <MessagingScreen
              conversationId={
                route.params?.conversationId ?? "default"
              }
              currentUserId="user-1"
              recipientName={route.params?.recipientName ?? "User"}
              onBack={() => navigation.goBack()}
            />
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
