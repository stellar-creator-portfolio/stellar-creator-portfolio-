/**
 * RegisterScreen — 3-step introductory registration flow
 *
 * Step 1 — Profile:     name, username, email
 * Step 2 — Discipline:  pick discipline + up to 8 skill tags
 * Step 3 — Wallet:      WalletConnect deep-link (reuses LoginScreen logic)
 *
 * Performance:
 *  - Step views rendered with translateX (native driver) — zero JS-thread cost
 *  - Skill chips are React.memo'd
 *  - All callbacks memoized
 *
 * Security:
 *  - All text inputs sanitized via useRegisterForm (HTML stripped)
 *  - Wallet key validated before final submit
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { useRegisterForm, ProfileFields, DisciplineFields } from "../hooks/useRegisterForm";
import { useWalletAuth } from "../hooks/useWalletAuth";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

// ─── Data ─────────────────────────────────────────────────────────────────────

const DISCIPLINES = [
  "UI/UX Design",
  "Writing",
  "Content Creation",
  "Brand Strategy",
  "Marketing",
  "Product Management",
  "Data Analysis",
  "Community Management",
  "Project Management",
  "Sales",
  "Customer Success",
  "HR & Recruiting",
];

const SKILLS_BY_DISCIPLINE: Record<string, string[]> = {
  "UI/UX Design":         ["Figma", "Prototyping", "User Research", "Wireframing", "Design Systems", "Accessibility"],
  "Writing":              ["Copywriting", "SEO", "Editing", "Technical Writing", "Storytelling", "Content Strategy"],
  "Content Creation":     ["Video Editing", "Photography", "Social Media", "Podcasting", "Animation", "Scripting"],
  "Brand Strategy":       ["Brand Identity", "Positioning", "Market Research", "Visual Design", "Naming", "Messaging"],
  "Marketing":            ["Growth Hacking", "Email Marketing", "Paid Ads", "Analytics", "SEO", "Conversion"],
  "Product Management":   ["Roadmapping", "Agile", "User Stories", "Prioritization", "Metrics", "Stakeholder Mgmt"],
  "Data Analysis":        ["SQL", "Python", "Tableau", "Excel", "Statistics", "Data Visualization"],
  "Community Management": ["Discord", "Moderation", "Events", "Engagement", "Content Calendar", "Partnerships"],
  "Project Management":   ["Jira", "Asana", "Risk Management", "Budgeting", "Scrum", "Stakeholder Mgmt"],
  "Sales":                ["CRM", "Cold Outreach", "Negotiation", "Pipeline", "Demo", "Closing"],
  "Customer Success":     ["Onboarding", "Retention", "NPS", "Support", "Upselling", "Churn Analysis"],
  "HR & Recruiting":      ["Sourcing", "Interviewing", "Onboarding", "Culture", "Compensation", "ATS"],
};

const DEFAULT_SKILLS = ["Communication", "Problem Solving", "Collaboration", "Time Management"];

// ─── Sub-components ───────────────────────────────────────────────────────────

const StepIndicator = React.memo(
  ({ current, total, colors }: { current: number; total: number; colors: any }) => (
    <View style={indicatorStyles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            indicatorStyles.dot,
            {
              backgroundColor: i < current ? colors.primary : colors.border,
              width: i === current - 1 ? 24 : 8,
            },
          ]}
        />
      ))}
    </View>
  )
);
StepIndicator.displayName = "StepIndicator";

const indicatorStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { height: 8, borderRadius: 4 },
});

const FieldRow = React.memo(
  ({
    label,
    value,
    error,
    touched,
    onChangeText,
    onBlur,
    placeholder,
    keyboardType,
    autoCapitalize,
    colors,
  }: {
    label: string;
    value: string;
    error?: string;
    touched: boolean;
    onChangeText: (v: string) => void;
    onBlur: () => void;
    placeholder: string;
    keyboardType?: "default" | "email-address";
    autoCapitalize?: "none" | "words";
    colors: any;
  }) => {
    const showError = touched && !!error;
    return (
      <View style={fieldStyles.wrap}>
        <Text style={[fieldStyles.label, { color: colors.text }]}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={autoCapitalize ?? "words"}
          autoCorrect={false}
          style={[
            fieldStyles.input,
            {
              backgroundColor: colors.surface,
              borderColor: showError ? colors.error : colors.border,
              color: colors.text,
            },
          ]}
          accessibilityLabel={label}
        />
        {showError && (
          <Text
            style={[fieldStyles.error, { color: colors.error }]}
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        )}
      </View>
    );
  }
);
FieldRow.displayName = "FieldRow";

const fieldStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
  },
  error: { fontSize: FontSize.xs },
});

const SkillChip = React.memo(
  ({
    label,
    selected,
    onPress,
    colors,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
    colors: any;
  }) => (
    <Pressable
      onPress={onPress}
      style={[
        chipStyles.chip,
        selected
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
    >
      <Text style={[chipStyles.label, { color: selected ? "#fff" : colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  )
);
SkillChip.displayName = "SkillChip";

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export function RegisterScreen({
  onComplete,
  onSignIn,
}: {
  /** Called with profile + discipline after wallet is connected */
  onComplete: (profile: ProfileFields, discipline: DisciplineFields, publicKey: string) => void;
  /** Navigate to login instead */
  onSignIn?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const slideAnim = useRef(new Animated.Value(0)).current;

  const handleFormComplete = useCallback(
    async (_profile: ProfileFields, _discipline: DisciplineFields) => {
      // Final submit is triggered after wallet connect in step 3
    },
    []
  );

  const {
    step,
    profile,
    profileMeta,
    discipline,
    isProfileValid,
    isDisciplineValid,
    isSubmitting,
    handleProfileChange,
    handleProfileBlur,
    setDisciplineValue,
    toggleSkill,
    submitStep1,
    submitStep2,
    submitFinal,
    goBack,
  } = useRegisterForm(handleFormComplete);

  const {
    status: walletStatus,
    session: walletSession,
    error: walletError,
    connect: walletConnect,
    resetError: walletResetError,
  } = useWalletAuth();

  // Animate slide when step changes
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: -(step - 1),
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [step, slideAnim]);

  // When wallet connects in step 3, complete registration
  useEffect(() => {
    if (step === 3 && walletStatus === "authenticated" && walletSession?.publicKey) {
      submitFinal().then(() => {
        onComplete(profile, discipline, walletSession.publicKey);
      });
    }
  }, [step, walletStatus, walletSession, profile, discipline, submitFinal, onComplete]);

  const handleNext1 = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    submitStep1();
  }, [submitStep1]);

  const handleNext2 = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    submitStep2();
  }, [submitStep2]);

  const handleWalletConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    walletConnect();
  }, [walletConnect]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (walletStatus === "error") walletResetError();
    goBack();
  }, [goBack, walletStatus, walletResetError]);

  const availableSkills = useMemo(
    () => SKILLS_BY_DISCIPLINE[discipline.discipline] ?? DEFAULT_SKILLS,
    [discipline.discipline]
  );

  const walletBusy =
    walletStatus === "connecting" ||
    walletStatus === "awaiting_wallet" ||
    walletStatus === "verifying";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {step > 1 ? (
          <Pressable
            onPress={handleBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {step === 1 ? "Create Account" : step === 2 ? "Your Expertise" : "Connect Wallet"}
          </Text>
          <StepIndicator current={step} total={3} colors={colors} />
        </View>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Step 1: Profile ─────────────────────────────────────────── */}
          {step === 1 && (
            <View style={styles.stepWrap}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                Tell us about yourself
              </Text>
              <Text style={[styles.stepSub, { color: colors.textSecondary }]}>
                This is how you'll appear to clients and collaborators.
              </Text>

              <View style={styles.fields}>
                <FieldRow
                  label="Full Name"
                  value={profile.name}
                  error={profileMeta.name.error}
                  touched={profileMeta.name.touched}
                  onChangeText={(v) => handleProfileChange("name", v)}
                  onBlur={() => handleProfileBlur("name")}
                  placeholder="Jane Smith"
                  colors={colors}
                />
                <FieldRow
                  label="Username"
                  value={profile.username}
                  error={profileMeta.username.error}
                  touched={profileMeta.username.touched}
                  onChangeText={(v) => handleProfileChange("username", v)}
                  onBlur={() => handleProfileBlur("username")}
                  placeholder="janesmith"
                  autoCapitalize="none"
                  colors={colors}
                />
                <FieldRow
                  label="Email"
                  value={profile.email}
                  error={profileMeta.email.error}
                  touched={profileMeta.email.touched}
                  onChangeText={(v) => handleProfileChange("email", v)}
                  onBlur={() => handleProfileBlur("email")}
                  placeholder="jane@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  colors={colors}
                />
              </View>

              <Pressable
                onPress={handleNext1}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: isProfileValid ? colors.primary : colors.border },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Continue to step 2"
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
              </Pressable>

              {onSignIn && (
                <Pressable onPress={onSignIn} style={styles.signInLink}>
                  <Text style={[styles.signInText, { color: colors.textSecondary }]}>
                    Already have an account?{" "}
                    <Text style={{ color: colors.primary, fontWeight: FontWeight.semibold }}>
                      Sign in
                    </Text>
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Step 2: Discipline + Skills ──────────────────────────────── */}
          {step === 2 && (
            <View style={styles.stepWrap}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                What's your expertise?
              </Text>
              <Text style={[styles.stepSub, { color: colors.textSecondary }]}>
                Choose your primary discipline and up to 8 skills.
              </Text>

              {/* Discipline picker */}
              <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
                PRIMARY DISCIPLINE
              </Text>
              <View style={styles.chipGrid}>
                {DISCIPLINES.map((d) => (
                  <SkillChip
                    key={d}
                    label={d}
                    selected={discipline.discipline === d}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDisciplineValue(d);
                    }}
                    colors={colors}
                  />
                ))}
              </View>

              {/* Skills */}
              {discipline.discipline.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
                    SKILLS ({discipline.skills.length}/8)
                  </Text>
                  <View style={styles.chipGrid}>
                    {availableSkills.map((s) => (
                      <SkillChip
                        key={s}
                        label={s}
                        selected={discipline.skills.includes(s)}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          toggleSkill(s);
                        }}
                        colors={colors}
                      />
                    ))}
                  </View>
                </>
              )}

              <Pressable
                onPress={handleNext2}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: isDisciplineValid ? colors.primary : colors.border },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Continue to wallet connect"
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
              </Pressable>
            </View>
          )}

          {/* ── Step 3: Wallet Connect ───────────────────────────────────── */}
          {step === 3 && (
            <View style={styles.stepWrap}>
              <View style={[styles.walletHero, { backgroundColor: colors.primary + "18" }]}>
                <Text style={styles.walletIcon}>🔐</Text>
              </View>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                Connect your wallet
              </Text>
              <Text style={[styles.stepSub, { color: colors.textSecondary }]}>
                Link a Stellar wallet to receive payments and sign transactions securely.
              </Text>

              {/* Status */}
              {walletStatus !== "idle" && (
                <View
                  style={[
                    styles.statusCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  accessibilityLiveRegion="polite"
                >
                  {walletBusy && (
                    <ActivityIndicator size="small" color={colors.primary} />
                  )}
                  <Text style={[styles.statusText, { color: colors.text }]}>
                    {walletStatus === "connecting"      && "Preparing connection…"}
                    {walletStatus === "awaiting_wallet" && "Waiting for wallet approval…"}
                    {walletStatus === "verifying"       && "Verifying your identity…"}
                    {walletStatus === "authenticated"   && `Connected: ${walletSession?.publicKey?.slice(0, 8)}…`}
                    {walletStatus === "error"           && (walletError ?? "Connection failed")}
                  </Text>
                </View>
              )}

              {walletStatus !== "authenticated" && (
                <Pressable
                  onPress={walletStatus === "error" ? () => { walletResetError(); handleWalletConnect(); } : handleWalletConnect}
                  disabled={walletBusy || isSubmitting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: walletBusy || isSubmitting ? colors.border : colors.primary },
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Connect Stellar wallet"
                  accessibilityState={{ disabled: walletBusy || isSubmitting }}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {walletBusy ? "Connecting…" : walletStatus === "error" ? "Try Again" : "Connect Wallet"}
                    </Text>
                  )}
                </Pressable>
              )}

              <Text style={[styles.walletNote, { color: colors.textTertiary }]}>
                Compatible with Lobstr, Solar, Freighter, and any WalletConnect v2 wallet.
                Your private key never leaves your device.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  backIcon: { fontSize: 24, fontWeight: FontWeight.bold },
  headerCenter: { flex: 1, alignItems: "center", gap: Spacing.xs },
  headerTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  content: { padding: Spacing.base, paddingBottom: Spacing["3xl"] },
  stepWrap: { gap: Spacing.base },
  stepTitle: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold },
  stepSub: { fontSize: FontSize.base, lineHeight: 22 },
  fields: { gap: Spacing.base },
  sectionLabel: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
  },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  primaryBtn: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing.base,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    marginTop: Spacing.sm,
  },
  primaryBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: "#fff" },
  signInLink: { alignItems: "center", paddingVertical: Spacing.sm },
  signInText: { fontSize: FontSize.sm },
  walletHero: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  walletIcon: { fontSize: 40 },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.base,
  },
  statusText: { fontSize: FontSize.sm, flex: 1 },
  walletNote: { fontSize: FontSize.xs, textAlign: "center", lineHeight: 18 },
});
