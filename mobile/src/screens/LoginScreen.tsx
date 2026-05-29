/**
 * LoginScreen — WalletConnect auth gateway
 *
 * Layout:
 *  - Hero logo + tagline
 *  - "Connect Wallet" CTA → triggers WC deep link
 *  - Status card that tracks the auth state machine
 *  - Authenticated state shows public key + disconnect
 *
 * Performance:
 *  - No heavy animations on the JS thread (native driver only)
 *  - StatusCard is React.memo — only re-renders on status change
 *  - All callbacks memoized
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { useWalletAuth, AuthStatus } from "../hooks/useWalletAuth";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  AuthStatus,
  { label: string; color: string; icon: string; showSpinner: boolean }
> = {
  idle:            { label: "Not connected",       color: "#94a3b8", icon: "○",  showSpinner: false },
  connecting:      { label: "Preparing…",          color: "#3b82f6", icon: "⟳",  showSpinner: true  },
  awaiting_wallet: { label: "Waiting for wallet…", color: "#f59e0b", icon: "📲", showSpinner: true  },
  verifying:       { label: "Verifying identity…", color: "#6366f1", icon: "🔐", showSpinner: true  },
  authenticated:   { label: "Connected",           color: "#22c55e", icon: "✓",  showSpinner: false },
  error:           { label: "Connection failed",   color: "#ef4444", icon: "✕",  showSpinner: false },
};

// ─── StatusCard ───────────────────────────────────────────────────────────────

const StatusCard = React.memo(
  ({
    status,
    publicKey,
    error,
    colors,
  }: {
    status: AuthStatus;
    publicKey?: string;
    error: string | null;
    colors: any;
  }) => {
    const cfg = STATUS_CONFIG[status];
    return (
      <View
        style={[
          cardStyles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Auth status: ${cfg.label}`}
      >
        <View style={cardStyles.row}>
          <View style={[cardStyles.dot, { backgroundColor: cfg.color }]} />
          <Text style={[cardStyles.label, { color: cfg.color }]}>{cfg.label}</Text>
          {cfg.showSpinner && (
            <ActivityIndicator size="small" color={cfg.color} style={cardStyles.spinner} />
          )}
        </View>

        {status === "authenticated" && publicKey && (
          <Text
            style={[cardStyles.key, { color: colors.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {publicKey}
          </Text>
        )}

        {status === "awaiting_wallet" && (
          <Text style={[cardStyles.hint, { color: colors.textTertiary }]}>
            Your wallet app should open automatically. Approve the connection request to continue.
          </Text>
        )}

        {status === "error" && error && (
          <Text style={[cardStyles.error, { color: colors.error }]}>{error}</Text>
        )}
      </View>
    );
  }
);
StatusCard.displayName = "StatusCard";

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, flex: 1 },
  spinner: { marginLeft: "auto" },
  key: { fontSize: FontSize.xs, fontFamily: "monospace" },
  hint: { fontSize: FontSize.sm, lineHeight: 20 },
  error: { fontSize: FontSize.sm, lineHeight: 20 },
});

// ─── WalletButton ─────────────────────────────────────────────────────────────

const WalletButton = React.memo(
  ({
    label,
    onPress,
    disabled,
    variant,
    colors,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
    variant: "primary" | "outline";
    colors: any;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        btnStyles.btn,
        variant === "primary"
          ? { backgroundColor: disabled ? colors.border : colors.primary }
          : { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
        pressed && !disabled && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text
        style={[
          btnStyles.label,
          { color: variant === "primary" ? "#fff" : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
);
WalletButton.displayName = "WalletButton";

const btnStyles = StyleSheet.create({
  btn: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing.base,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  label: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export function LoginScreen({
  onAuthenticated,
  onRegister,
}: {
  /** Called once the user is fully authenticated */
  onAuthenticated?: (publicKey: string) => void;
  /** Navigate to registration flow */
  onRegister?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const { status, session, error, connect, disconnect, resetError } = useWalletAuth();

  // Fade-in hero on mount
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Notify parent when authenticated
  useEffect(() => {
    if (status === "authenticated" && session?.publicKey) {
      onAuthenticated?.(session.publicKey);
    }
  }, [status, session, onAuthenticated]);

  const handleConnect = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await connect();
  }, [connect]);

  const handleDisconnect = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await disconnect();
  }, [disconnect]);

  const handleRetry = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetError();
  }, [resetError]);

  const isBusy =
    status === "connecting" ||
    status === "awaiting_wallet" ||
    status === "verifying";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <Animated.View style={[styles.hero, { opacity: fadeAnim }]}>
          <View style={[styles.logoWrap, { backgroundColor: colors.primary + "18" }]}>
            <Text style={styles.logoText}>✦</Text>
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>Stellar</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Connect your Stellar wallet to access the creator marketplace
          </Text>
        </Animated.View>

        {/* Status card */}
        <StatusCard
          status={status}
          publicKey={session?.publicKey}
          error={error}
          colors={colors}
        />

        {/* Supported wallets */}
        <View style={[styles.walletsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.walletsTitle, { color: colors.textTertiary }]}>
            COMPATIBLE WALLETS
          </Text>
          {["Lobstr", "Solar Wallet", "Freighter", "Any WalletConnect v2 wallet"].map((w) => (
            <View key={w} style={styles.walletRow}>
              <View style={[styles.walletDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.walletName, { color: colors.text }]}>{w}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {status === "authenticated" ? (
            <WalletButton
              label="Disconnect Wallet"
              onPress={handleDisconnect}
              disabled={false}
              variant="outline"
              colors={colors}
            />
          ) : status === "error" ? (
            <>
              <WalletButton
                label="Try Again"
                onPress={handleRetry}
                disabled={false}
                variant="primary"
                colors={colors}
              />
            </>
          ) : (
            <WalletButton
              label={isBusy ? "Connecting…" : "Connect Wallet"}
              onPress={handleConnect}
              disabled={isBusy}
              variant="primary"
              colors={colors}
            />
          )}
        </View>

        {/* Legal note */}
        <Text style={[styles.legal, { color: colors.textTertiary }]}>
          By connecting, you agree to Stellar's Terms of Service. Your private key never leaves your wallet.
        </Text>

        {onRegister && (
          <Pressable onPress={onRegister} style={styles.registerLink}>
            <Text style={[styles.registerText, { color: colors.textSecondary }]}>
              New to Stellar?{" "}
              <Text style={{ color: colors.primary, fontWeight: FontWeight.semibold }}>
                Create an account
              </Text>
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing["3xl"],
    gap: Spacing.base,
  },
  hero: { alignItems: "center", paddingVertical: Spacing["2xl"], gap: Spacing.md },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { fontSize: 40 },
  appName: { fontSize: FontSize["3xl"], fontWeight: FontWeight.extrabold },
  tagline: { fontSize: FontSize.base, textAlign: "center", lineHeight: 22, maxWidth: 280 },
  walletsCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  walletsTitle: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
  },
  walletRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  walletDot: { width: 6, height: 6, borderRadius: 3 },
  walletName: { fontSize: FontSize.sm },
  actions: { gap: Spacing.sm },
  legal: { fontSize: FontSize.xs, textAlign: "center", lineHeight: 18 },
  registerLink: { alignItems: "center", paddingVertical: Spacing.sm },
  registerText: { fontSize: FontSize.sm },
});
