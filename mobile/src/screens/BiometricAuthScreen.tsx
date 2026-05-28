import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { ActionButton } from "../components/buttons/ActionButton";
import {
  getBiometricSupport,
  authenticateBiometric,
} from "../services/BiometricAuthService";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

export function BiometricAuthScreen() {
  const { colors, isDark } = useTheme();
  const [status, setStatus] = useState<
    "idle" | "available" | "unavailable" | "busy" | "authenticated"
  >("idle");
  const [methods, setMethods] = useState<string[]>([]);
  const [message, setMessage] = useState<string>(
    "Checking biometric capabilities…",
  );

  useEffect(() => {
    let isMounted = true;

    async function detect() {
      const support = await getBiometricSupport();
      if (!isMounted) return;

      if (support.supported) {
        setStatus("available");
        setMethods(support.methods);
        setMessage(
          `Native biometric authentication is ready: ${support.methods.join(", ")}.`,
        );
      } else {
        setStatus("unavailable");
        setMessage(
          support.reason ??
            "Biometric authentication is not available on this device.",
        );
      }
    }

    detect();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAuthenticate = useCallback(async () => {
    setStatus("busy");
    setMessage("Waiting for biometric confirmation…");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await authenticateBiometric();
    if (result.success) {
      setStatus("authenticated");
      setMessage("Authentication succeeded. Welcome back to Stellar.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setStatus("available");
      setMessage(result.error ?? "Authentication was not completed.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            Secure access
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Use Face ID or Touch ID to unlock Stellar securely with native
            biometric capabilities.
          </Text>

          <View style={styles.statusRow}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>
              Status
            </Text>
            <Text
              style={[
                styles.statusValue,
                {
                  color:
                    status === "available" || status === "authenticated"
                      ? colors.success
                      : colors.error,
                },
              ]}
            >
              {status === "busy"
                ? "Authenticating…"
                : status === "authenticated"
                  ? "Authenticated"
                  : status === "available"
                    ? "Available"
                    : "Unavailable"}
            </Text>
          </View>

          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {message}
          </Text>
          {methods.length > 0 && (
            <Text style={[styles.methods, { color: colors.text }]}>
              {methods.join(" • ")}
            </Text>
          )}
        </View>

        <View style={[styles.actionArea, { backgroundColor: colors.surface }]}>
          <ActionButton
            title={
              status === "authenticated"
                ? "Recheck capabilities"
                : "Authenticate now"
            }
            variant="primary"
            onPress={handleAuthenticate}
            accessibilityLabel="Authenticate using device biometrics"
          />
          {status === "unavailable" && (
            <Text style={[styles.warning, { color: colors.error }]}>
              Native biometric support is not configured on this device. Install
              expo-local-authentication and enroll a biometric credential to
              enable secure login.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing["3xl"],
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    ...Shadow.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  statusLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  statusValue: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  message: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  methods: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    letterSpacing: 0.2,
  },
  actionArea: {
    marginTop: Spacing.lg,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: "transparent",
  },
  warning: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    marginTop: Spacing.md,
  },
});
