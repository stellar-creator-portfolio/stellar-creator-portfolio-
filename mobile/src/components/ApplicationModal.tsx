/**
 * ApplicationModal — Read-only status modal for an existing application
 *
 * Shows: status badge, submitted fields, timeline, and action buttons.
 * Animated slide-up, accessible, dark-mode aware.
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApplicationStatus =
  | "pending"
  | "reviewing"
  | "accepted"
  | "rejected"
  | "withdrawn";

export interface ApplicationRecord {
  id: string;
  bountyId: string;
  bountyTitle: string;
  budget: number;
  currency: string;
  coverLetter: string;
  proposedRate: number;
  estimatedDays: number;
  portfolioUrl?: string;
  status: ApplicationStatus;
  submittedAt: string;   // ISO date string
  updatedAt?: string;
  reviewerNote?: string;
}

interface ApplicationModalProps {
  visible: boolean;
  application: ApplicationRecord | null;
  onClose: () => void;
  onWithdraw?: (applicationId: string) => Promise<void>;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; color: string; bg: string; icon: string }
> = {
  pending:   { label: "Pending Review", color: "#f59e0b", bg: "#fef3c7", icon: "⏳" },
  reviewing: { label: "Under Review",   color: "#3b82f6", bg: "#dbeafe", icon: "🔍" },
  accepted:  { label: "Accepted",       color: "#22c55e", bg: "#dcfce7", icon: "✅" },
  rejected:  { label: "Not Selected",   color: "#ef4444", bg: "#fee2e2", icon: "✗" },
  withdrawn: { label: "Withdrawn",      color: "#94a3b8", bg: "#f1f5f9", icon: "↩" },
};

// ─── Detail row ───────────────────────────────────────────────────────────────

const DetailRow = React.memo(
  ({ label, value, colors }: { label: string; value: string; colors: any }) => (
    <View style={detailStyles.row}>
      <Text style={[detailStyles.label, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[detailStyles.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
);
DetailRow.displayName = "DetailRow";

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: Spacing.xs,
  },
  label: { fontSize: FontSize.sm, flex: 1 },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 2, textAlign: "right" },
});

// ─── Modal ────────────────────────────────────────────────────────────────────

export const ApplicationModal = React.memo(
  ({ visible, application, onClose, onWithdraw }: ApplicationModalProps) => {
    const { colors } = useTheme();
    const slideAnim = useRef(new Animated.Value(600)).current;
    const [withdrawing, setWithdrawing] = React.useState(false);
    const [withdrawError, setWithdrawError] = React.useState<string | null>(null);

    useEffect(() => {
      Animated.spring(slideAnim, {
        toValue: visible ? 0 : 600,
        useNativeDriver: true,
        bounciness: 4,
        speed: 14,
      }).start();
      if (!visible) {
        setWithdrawError(null);
        setWithdrawing(false);
      }
    }, [visible, slideAnim]);

    const handleWithdraw = useCallback(async () => {
      if (!application || !onWithdraw) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setWithdrawError(null);
      setWithdrawing(true);
      try {
        await onWithdraw(application.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      } catch (err) {
        setWithdrawError(
          err instanceof Error ? err.message : "Failed to withdraw. Please try again."
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setWithdrawing(false);
      }
    }, [application, onWithdraw, onClose]);

    if (!application) return null;

    const status = STATUS_CONFIG[application.status];
    const canWithdraw =
      onWithdraw &&
      (application.status === "pending" || application.status === "reviewing");

    const submittedDate = new Date(application.submittedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close application modal"
        />

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
                Application Details
              </Text>
              <Text
                style={[styles.headerSub, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {application.bountyTitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
            >
              <Text style={[styles.closeIcon, { color: colors.textTertiary }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Status badge */}
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={styles.statusIcon}>{status.icon}</Text>
              <Text style={[styles.statusLabel, { color: status.color }]}>
                {status.label}
              </Text>
            </View>

            {/* Reviewer note */}
            {application.reviewerNote && (
              <View
                style={[
                  styles.reviewerNote,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.reviewerNoteLabel, { color: colors.textTertiary }]}>
                  Reviewer Note
                </Text>
                <Text style={[styles.reviewerNoteText, { color: colors.text }]}>
                  {application.reviewerNote}
                </Text>
              </View>
            )}

            {/* Submission details */}
            <View style={[styles.section, { borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                YOUR SUBMISSION
              </Text>
              <DetailRow
                label="Proposed Rate"
                value={`$${application.proposedRate.toLocaleString()} ${application.currency}`}
                colors={colors}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <DetailRow
                label="Estimated Days"
                value={`${application.estimatedDays} days`}
                colors={colors}
              />
              {application.portfolioUrl && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <DetailRow
                    label="Portfolio"
                    value={application.portfolioUrl}
                    colors={colors}
                  />
                </>
              )}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <DetailRow label="Submitted" value={submittedDate} colors={colors} />
            </View>

            {/* Cover letter */}
            <View style={[styles.section, { borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                COVER LETTER
              </Text>
              <Text style={[styles.coverLetter, { color: colors.text }]}>
                {application.coverLetter}
              </Text>
            </View>

            {withdrawError && (
              <View style={[styles.errorBanner, { backgroundColor: colors.errorLight }]}>
                <Text style={[styles.errorText, { color: colors.error }]}>{withdrawError}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={onClose}
              style={[styles.closeFooterBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.closeFooterText, { color: colors.textSecondary }]}>
                Close
              </Text>
            </Pressable>
            {canWithdraw && (
              <Pressable
                onPress={handleWithdraw}
                disabled={withdrawing}
                style={({ pressed }) => [
                  styles.withdrawBtn,
                  { backgroundColor: colors.error },
                  pressed && { opacity: 0.85 },
                  withdrawing && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Withdraw application"
                accessibilityState={{ disabled: withdrawing }}
              >
                <Text style={styles.withdrawText}>
                  {withdrawing ? "Withdrawing…" : "Withdraw"}
                </Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </Modal>
    );
  }
);

ApplicationModal.displayName = "ApplicationModal";

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    maxHeight: "88%",
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
  closeBtn: { padding: Spacing.xs },
  closeIcon: { fontSize: FontSize.base },
  scroll: { flexGrow: 0 },
  scrollContent: { padding: Spacing.base, gap: Spacing.base },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.xl,
    gap: Spacing.xs,
  },
  statusIcon: { fontSize: FontSize.base },
  statusLabel: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  reviewerNote: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: Spacing.xs,
  },
  reviewerNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  reviewerNoteText: { fontSize: FontSize.sm, lineHeight: 20 },
  section: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  coverLetter: { fontSize: FontSize.sm, lineHeight: 22 },
  errorBanner: { borderRadius: Radius.lg, padding: Spacing.sm },
  errorText: { fontSize: FontSize.sm },
  footer: {
    flexDirection: "row",
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  closeFooterBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  closeFooterText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  withdrawBtn: {
    flex: 1,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  withdrawText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: "#fff" },
});
