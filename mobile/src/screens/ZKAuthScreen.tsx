/**
 * ZKAuthScreen — Zero-Knowledge Proof authentication UI
 *
 * Issue #584: [Mobile] Implement Zero-Knowledge Proof (zk-SNARK) auth mechanisms
 *
 * Flow:
 *  1. User enters their credential identifier (e.g. KYC document ID)
 *  2. App generates a zk-SNARK proof on-device (no raw credential is sent)
 *  3. Proof is verified locally; the resulting commitment acts as an
 *     anonymous session token
 *  4. Success state shows the commitment hash — proof of identity without
 *     revealing the underlying credential
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { ActionButton } from "../components/buttons/ActionButton";
import { proveAndVerify, ZKVerifyResult } from "../services/ZKProofService";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthStep = "input" | "proving" | "verified" | "failed";

// ─── Component ────────────────────────────────────────────────────────────────

export function ZKAuthScreen() {
  const { colors, isDark } = useTheme();

  const [step, setStep] = useState<AuthStep>("input");
  const [credentialId, setCredentialId] = useState("");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<ZKVerifyResult | null>(null);

  const handleProve = useCallback(async () => {
    if (!credentialId.trim() || !secret.trim()) return;

    setStep("proving");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const verifyResult = await proveAndVerify({
      credentialHash: credentialId.trim(),
      secret: secret.trim(),
    });

    setResult(verifyResult);

    if (verifyResult.valid) {
      setStep("verified");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setStep("failed");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [credentialId, secret]);

  const handleReset = useCallback(() => {
    setStep("input");
    setCredentialId("");
    setSecret("");
    setResult(null);
  }, []);

  const statusColor =
    step === "verified"
      ? colors.success
      : step === "failed"
        ? colors.error
        : colors.primary;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            Zero-Knowledge Auth
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Prove your identity without revealing your credentials. Your private
            data never leaves this device.
          </Text>
        </View>

        {/* Privacy badge */}
        <View
          style={[
            styles.badge,
            { backgroundColor: colors.primaryLight + "22", borderColor: colors.primary + "44" },
          ]}
        >
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            🔒  On-device zk-SNARK proof  •  No data transmitted
          </Text>
        </View>

        {/* Input card */}
        {(step === "input" || step === "proving") && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Credential identifier
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="e.g. KYC document hash"
              placeholderTextColor={colors.placeholder}
              value={credentialId}
              onChangeText={setCredentialId}
              autoCapitalize="none"
              autoCorrect={false}
              editable={step === "input"}
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Secret passphrase
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="Your private secret"
              placeholderTextColor={colors.placeholder}
              value={secret}
              onChangeText={setSecret}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={step === "input"}
            />

            {step === "proving" ? (
              <View style={styles.provingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.provingText, { color: colors.textSecondary }]}>
                  Generating zk-SNARK proof…
                </Text>
              </View>
            ) : (
              <ActionButton
                title="Generate & Verify Proof"
                variant="primary"
                onPress={handleProve}
                accessibilityLabel="Generate zero-knowledge proof and verify identity"
              />
            )}
          </View>
        )}

        {/* Result card */}
        {(step === "verified" || step === "failed") && result && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: statusColor + "66",
              },
            ]}
          >
            <Text style={[styles.resultIcon]}>
              {step === "verified" ? "✅" : "❌"}
            </Text>
            <Text style={[styles.resultTitle, { color: statusColor }]}>
              {step === "verified" ? "Proof Verified" : "Verification Failed"}
            </Text>

            {step === "verified" && result.commitment && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Anonymous commitment (public)
                </Text>
                <View
                  style={[
                    styles.commitmentBox,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.commitmentText, { color: colors.text }]}
                    selectable
                  >
                    {result.commitment}
                  </Text>
                </View>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  This commitment proves your credential is valid without
                  exposing any private information.
                </Text>
              </>
            )}

            {step === "failed" && (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {result.error ?? "The proof could not be verified."}
              </Text>
            )}

            <ActionButton
              title="Try Again"
              variant="secondary"
              onPress={handleReset}
              accessibilityLabel="Reset and try zero-knowledge proof again"
            />
          </View>
        )}

        {/* How it works */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.infoTitle, { color: colors.text }]}>
            How it works
          </Text>
          {[
            ["1", "You provide a credential ID and a secret passphrase."],
            ["2", "A Groth16 zk-SNARK circuit computes a cryptographic proof on-device."],
            ["3", "The proof is verified locally — only the commitment hash is produced."],
            ["4", "The commitment acts as your anonymous session token."],
          ].map(([n, text]) => (
            <View key={n} style={styles.infoRow}>
              <View style={[styles.infoNum, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[styles.infoNumText, { color: colors.primary }]}>{n}</Text>
              </View>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Spacing["3xl"] },

  header: { marginBottom: Spacing.lg },
  title: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.base, lineHeight: 22 },

  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    alignSelf: "flex-start",
    marginBottom: Spacing.lg,
  },
  badgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium },

  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },

  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    marginBottom: Spacing.md,
  },

  provingRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.sm },
  provingText: { fontSize: FontSize.sm },

  resultIcon: { fontSize: 36, textAlign: "center", marginBottom: Spacing.sm },
  resultTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: "center", marginBottom: Spacing.lg },

  commitmentBox: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  commitmentText: { fontSize: FontSize.xs, fontFamily: "monospace", lineHeight: 18 },
  hint: { fontSize: FontSize.xs, lineHeight: 18, marginBottom: Spacing.lg },
  errorText: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.lg, textAlign: "center" },

  infoCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    ...Shadow.sm,
  },
  infoTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, marginBottom: Spacing.md },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm, marginBottom: Spacing.sm },
  infoNum: { width: 24, height: 24, borderRadius: Radius.full, alignItems: "center", justifyContent: "center" },
  infoNumText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  infoText: { flex: 1, fontSize: FontSize.sm, lineHeight: 20 },
});
