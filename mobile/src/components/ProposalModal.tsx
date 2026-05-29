/**
 * ProposalModal — Bottom-sheet modal for submitting a bounty proposal
 *
 * Security:
 *  - All text inputs sanitized (HTML stripped) via useProposalForm
 *  - Keyboard-avoiding layout prevents content obscuring
 *  - Backdrop tap dismisses only when not submitting
 *
 * Performance:
 *  - Modal renders outside the list tree (no FlatList re-renders)
 *  - Animated slide-up via Animated.Value (no layout recalculation)
 *  - All callbacks memoized
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { useProposalForm, ProposalFields } from "../hooks/useProposalForm";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BountySummary {
  id: string;
  title: string;
  budget: number;
  currency: string;
  difficulty: string;
  category: string;
}

interface ProposalModalProps {
  visible: boolean;
  bounty: BountySummary | null;
  onClose: () => void;
  /** Called with sanitized, validated fields. Throw to surface an error. */
  onSubmit: (bountyId: string, fields: ProposalFields) => Promise<void>;
}

// ─── Field row ────────────────────────────────────────────────────────────────

const FieldRow = React.memo(
  ({
    label,
    value,
    error,
    touched,
    onChangeText,
    onBlur,
    placeholder,
    multiline,
    keyboardType,
    maxLength,
    colors,
  }: {
    label: string;
    value: string;
    error?: string;
    touched: boolean;
    onChangeText: (v: string) => void;
    onBlur: () => void;
    placeholder: string;
    multiline?: boolean;
    keyboardType?: "default" | "numeric" | "url";
    maxLength?: number;
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
          multiline={multiline}
          keyboardType={keyboardType ?? "default"}
          maxLength={maxLength}
          autoCorrect={false}
          autoCapitalize="sentences"
          style={[
            fieldStyles.input,
            multiline && fieldStyles.multiline,
            {
              backgroundColor: colors.surface,
              borderColor: showError ? colors.error : colors.border,
              color: colors.text,
            },
          ]}
          accessibilityLabel={label}
          accessibilityHint={placeholder}
        />
        {showError && (
          <Text
            style={[fieldStyles.error, { color: colors.error }]}
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        )}
        {multiline && (
          <Text style={[fieldStyles.charCount, { color: colors.textTertiary }]}>
            {value.length}/{maxLength ?? 2000}
          </Text>
        )}
      </View>
    );
  }
);

FieldRow.displayName = "FieldRow";

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: Spacing.base },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: Spacing.xs },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
  },
  multiline: { minHeight: 100, textAlignVertical: "top", paddingTop: Spacing.sm },
  error: { fontSize: FontSize.xs, marginTop: Spacing.xs },
  charCount: { fontSize: FontSize.xs, textAlign: "right", marginTop: 2 },
});

// ─── Modal ────────────────────────────────────────────────────────────────────

export const ProposalModal = React.memo(
  ({ visible, bounty, onClose, onSubmit }: ProposalModalProps) => {
    const { colors } = useTheme();
    const slideAnim = useRef(new Animated.Value(600)).current;
    const [submitError, setSubmitError] = React.useState<string | null>(null);

    // Animate in/out
    useEffect(() => {
      Animated.spring(slideAnim, {
        toValue: visible ? 0 : 600,
        useNativeDriver: true,
        bounciness: 4,
        speed: 14,
      }).start();
      if (!visible) setSubmitError(null);
    }, [visible, slideAnim]);

    const handleSubmit = useCallback(
      async (fields: ProposalFields) => {
        if (!bounty) return;
        setSubmitError(null);
        try {
          await onSubmit(bounty.id, fields);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onClose();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Submission failed. Please try again.";
          setSubmitError(msg);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      },
      [bounty, onSubmit, onClose]
    );

    const { fields, meta, isValid, isSubmitting, handleChange, handleBlur, submit, reset } =
      useProposalForm(handleSubmit);

    const handleClose = useCallback(() => {
      if (isSubmitting) return;
      reset();
      onClose();
    }, [isSubmitting, reset, onClose]);

    const handlePressSubmit = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      submit();
    }, [submit]);

    if (!bounty) return null;

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        {/* Backdrop */}
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityLabel="Close proposal modal"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.kavWrapper}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: colors.background, transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Handle */}
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  Submit Proposal
                </Text>
                <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {bounty.title}
                </Text>
              </View>
              <View style={[styles.budgetBadge, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[styles.budgetText, { color: colors.primary }]}>
                  ${bounty.budget.toLocaleString()} {bounty.currency}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
              >
                <Text style={[styles.closeIcon, { color: colors.textTertiary }]}>✕</Text>
              </Pressable>
            </View>

            {/* Form */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <FieldRow
                label="Cover Letter *"
                value={fields.coverLetter}
                error={meta.coverLetter.error}
                touched={meta.coverLetter.touched}
                onChangeText={(v) => handleChange("coverLetter", v)}
                onBlur={() => handleBlur("coverLetter")}
                placeholder="Describe your approach, relevant experience, and why you're the best fit…"
                multiline
                maxLength={2000}
                colors={colors}
              />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <FieldRow
                    label="Rate (USD) *"
                    value={fields.proposedRate}
                    error={meta.proposedRate.error}
                    touched={meta.proposedRate.touched}
                    onChangeText={(v) => handleChange("proposedRate", v)}
                    onBlur={() => handleBlur("proposedRate")}
                    placeholder="e.g. 1500"
                    keyboardType="numeric"
                    colors={colors}
                  />
                </View>
                <View style={{ width: Spacing.sm }} />
                <View style={{ flex: 1 }}>
                  <FieldRow
                    label="Est. Days *"
                    value={fields.estimatedDays}
                    error={meta.estimatedDays.error}
                    touched={meta.estimatedDays.touched}
                    onChangeText={(v) => handleChange("estimatedDays", v)}
                    onBlur={() => handleBlur("estimatedDays")}
                    placeholder="e.g. 14"
                    keyboardType="numeric"
                    colors={colors}
                  />
                </View>
              </View>
              <FieldRow
                label="Portfolio URL"
                value={fields.portfolioUrl}
                error={meta.portfolioUrl.error}
                touched={meta.portfolioUrl.touched}
                onChangeText={(v) => handleChange("portfolioUrl", v)}
                onBlur={() => handleBlur("portfolioUrl")}
                placeholder="https://yourportfolio.com (optional)"
                keyboardType="url"
                colors={colors}
              />

              {submitError && (
                <View style={[styles.errorBanner, { backgroundColor: colors.errorLight }]}>
                  <Text style={[styles.errorBannerText, { color: colors.error }]}>
                    {submitError}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={handleClose}
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handlePressSubmit}
                disabled={isSubmitting}
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: isValid ? colors.primary : colors.border },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Submit proposal"
                accessibilityState={{ disabled: isSubmitting }}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Submit Proposal</Text>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }
);

ProposalModal.displayName = "ProposalModal";

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  kavWrapper: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    maxHeight: "90%",
    paddingBottom: Platform.OS === "ios" ? Spacing["2xl"] : Spacing.base,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSub: { fontSize: FontSize.xs, marginTop: 1 },
  budgetBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  budgetText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  closeBtn: { padding: Spacing.xs },
  closeIcon: { fontSize: FontSize.base },
  scroll: { flexGrow: 0 },
  scrollContent: { padding: Spacing.base },
  row: { flexDirection: "row" },
  errorBanner: {
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
  },
  errorBannerText: { fontSize: FontSize.sm },
  footer: {
    flexDirection: "row",
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  cancelText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  submitBtn: {
    flex: 2,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  submitText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: "#fff" },
});
