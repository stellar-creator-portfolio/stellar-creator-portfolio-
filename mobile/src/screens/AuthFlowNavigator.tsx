/**
 * AuthFlowNavigator — sequences the introductory auth flow
 *
 * Flow:
 *   First launch:  Onboarding → Register (or Sign In) → app
 *   Returning:     skip straight to app (session restored by useWalletAuth)
 *
 * Persists completion flags in AsyncStorage so the onboarding
 * and register screens are never shown again after first completion.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OnboardingScreen } from "./OnboardingScreen";
import { RegisterScreen } from "./RegisterScreen";
import { LoginScreen } from "./LoginScreen";
import { ProfileFields, DisciplineFields } from "../hooks/useRegisterForm";
import { useTheme } from "../theme/ThemeProvider";

// ─── Persistence keys ─────────────────────────────────────────────────────────

const KEY_ONBOARDING_DONE = "@stellar/onboarding_done";
const KEY_REGISTERED      = "@stellar/registered";

// ─── Types ────────────────────────────────────────────────────────────────────

type FlowStep = "loading" | "onboarding" | "register" | "login" | "done";

interface AuthFlowNavigatorProps {
  /** Called when the user is fully authenticated and ready to enter the app */
  onAuthComplete: (publicKey: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthFlowNavigator({ onAuthComplete }: AuthFlowNavigatorProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<FlowStep>("loading");

  // Determine starting step from persisted flags
  useEffect(() => {
    (async () => {
      const [onboardingDone, registered] = await Promise.all([
        AsyncStorage.getItem(KEY_ONBOARDING_DONE),
        AsyncStorage.getItem(KEY_REGISTERED),
      ]);

      if (!onboardingDone) {
        setStep("onboarding");
      } else if (!registered) {
        setStep("register");
      } else {
        // Already registered — go straight to login (wallet session may still be valid)
        setStep("login");
      }
    })();
  }, []);

  const handleOnboardingComplete = useCallback(async () => {
    await AsyncStorage.setItem(KEY_ONBOARDING_DONE, "1");
    setStep("register");
  }, []);

  const handleRegisterComplete = useCallback(
    async (
      _profile: ProfileFields,
      _discipline: DisciplineFields,
      publicKey: string
    ) => {
      await AsyncStorage.setItem(KEY_REGISTERED, "1");
      onAuthComplete(publicKey);
    },
    [onAuthComplete]
  );

  const handleLoginAuthenticated = useCallback(
    (publicKey: string) => {
      onAuthComplete(publicKey);
    },
    [onAuthComplete]
  );

  const handleShowSignIn = useCallback(() => setStep("login"), []);
  const handleShowRegister = useCallback(() => setStep("register"), []);

  if (step === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (step === "onboarding") {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  if (step === "register") {
    return (
      <RegisterScreen
        onComplete={handleRegisterComplete}
        onSignIn={handleShowSignIn}
      />
    );
  }

  // step === "login" | "done"
  return (
    <LoginScreen
      onAuthenticated={handleLoginAuthenticated}
      onRegister={handleShowRegister}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
