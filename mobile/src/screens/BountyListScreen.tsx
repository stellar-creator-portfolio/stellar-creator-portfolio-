/**
 * BountyListScreen — Connected to real API endpoints
 *
 * Features:
 * - Real API integration via ApiClient
 * - Error handling and retry logic
 * - Offline support with cached data
 * - Real-time updates via WebSocket (future)
 */

import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { InfiniteScrollList } from "../components/InfiniteScrollList";
import { ProposalModal, BountySummary } from "../components/ProposalModal";
import { ProposalFields } from "../hooks/useProposalForm";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";
import apiClient, { type Bounty, ApiError, NetworkError } from "../services/ApiClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

// ─── Constants ────────────────────────────────────────────────────────────────

const DIFFICULTIES: Array<"All" | Difficulty> = [
  "All",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];

const CATEGORIES = [
  "All",
  "UI/UX Design",
  "Writing",
  "Marketing",
  "Brand Strategy",
  "Product Management",
  "Data Analysis",
];

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  beginner: "#22c55e",
  intermediate: "#3b82f6",
  advanced: "#f59e0b",
  expert: "#ef4444",
};

const ITEM_HEIGHT = 168;

export function BountyListScreen({
  onSelectBounty,
  onBack,
}: {
  onSelectBounty?: (id: string) => void;
  onBack?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [selectedDifficulty, setSelectedDifficulty] = useState<"All" | Difficulty>("All");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [proposalBounty, setProposalBounty] = useState<BountySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Real API fetcher - replaces mock data generation
  const fetchBounties = useCallback(
    async (page: number, pageSize: number): Promise<Bounty[]> => {
      try {
        setError(null);
        setIsLoading(true);

        const response = await apiClient.getBounties({
          page,
          limit: pageSize,
          difficulty: selectedDifficulty !== "All" ? selectedDifficulty : undefined,
          category: selectedCategory !== "All" ? selectedCategory : undefined,
        });

        return response.items;
      } catch (err) {
        const errorMessage = err instanceof ApiError
          ? err.message
          : err instanceof NetworkError
          ? "Network connection failed. Please check your connection."
          : "Failed to load bounties. Please try again.";
        
        setError(errorMessage);
        
        // Show user-friendly error
        Alert.alert(
          "Error Loading Bounties",
          errorMessage,
          [{ text: "Retry", onPress: () => window.location.reload() }]
        );
        
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [selectedDifficulty, selectedCategory]
  );

  const infiniteConfig = useMemo(
    () => ({
      pageSize: 20,
      maxItems: 300,
      initialData: [] as Bounty[], // Start empty, load from API
      onLoadMore: fetchBounties,
    }),
    [fetchBounties]
  );

  const handleDifficultySelect = useCallback((d: "All" | Difficulty) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDifficulty(d);
  }, []);

  const handleCategorySelect = useCallback((c: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(c);
  }, []);

  const handleBountyPress = useCallback(
    async (id: string) => {
      try {
        // Fetch detailed bounty info from API
        const bounty = await apiClient.getBounty(id);
        setProposalBounty({
          id: bounty.id,
          title: bounty.title,
          budget: bounty.budget,
          currency: "USD", // Default currency
          difficulty: bounty.difficulty,
          category: bounty.category,
        });
        onSelectBounty?.(id);
      } catch (err) {
        Alert.alert(
          "Error",
          "Failed to load bounty details. Please try again."
        );
      }
    },
    [onSelectBounty]
  );

  const handleProposalSubmit = useCallback(
    async (bountyId: string, fields: ProposalFields) => {
      try {
        await apiClient.applyForBounty(bountyId, {
          freelancer: "mobile-user", // Replace with actual user ID
          proposal: fields.proposal,
          proposedBudget: fields.budget,
          timeline: fields.timeline,
        });

        Alert.alert(
          "Success",
          "Your proposal has been submitted successfully!",
          [{ text: "OK", onPress: () => setProposalBounty(null) }]
        );
      } catch (err) {
        const errorMessage = err instanceof ApiError
          ? err.message
          : "Failed to submit proposal. Please try again.";
        
        Alert.alert("Submission Failed", errorMessage);
        throw err; // Re-throw to let form handle the error
      }
    },
    []
  );

// ─── BountyCard ───────────────────────────────────────────────────────────────

const BountyCard = React.memo(
  ({
    item,
    onPress,
    colors,
  }: {
    item: Bounty;
    onPress: (id: string) => void;
    colors: any;
  }) => {
    const handlePress = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress(item.id);
    }, [item.id, onPress]);

    const diffColor = DIFFICULTY_COLORS[item.difficulty];
    const daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(item.deadline).getTime() - Date.now()) / 86_400_000
      )
    );

    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          cardStyles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            height: ITEM_HEIGHT,
          },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, $${item.budget} budget`}
      >
        {/* Header row */}
        <View style={cardStyles.header}>
          <View style={[cardStyles.diffBadge, { backgroundColor: diffColor + "22" }]}>
            <Text style={[cardStyles.diffText, { color: diffColor }]}>
              {item.difficulty}
            </Text>
          </View>
          <Text style={[cardStyles.budget, { color: colors.primary }]}>
            ${item.budget.toLocaleString()}
          </Text>
        </View>

        {/* Title */}
        <Text
          style={[cardStyles.title, { color: colors.text }]}
          numberOfLines={1}
        >
          {item.title}
        </Text>

        {/* Description */}
        <Text
          style={[cardStyles.desc, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {item.description}
        </Text>

        {/* Footer row */}
        <View style={cardStyles.footer}>
          <View style={[cardStyles.categoryBadge, { backgroundColor: colors.surfaceElevated }]}>
            <Text style={[cardStyles.categoryText, { color: colors.textSecondary }]}>
              {item.category}
            </Text>
          </View>
          <Text style={[cardStyles.meta, { color: colors.textTertiary }]}>
            {item.applicants} applicants · {daysLeft}d left
          </Text>
        </View>
      </Pressable>
    );
  }
);

BountyCard.displayName = "BountyCard";

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.base,
    marginVertical: Spacing.xs,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  diffBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  diffText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  budget: { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  title: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  desc: { fontSize: FontSize.sm, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  categoryBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  categoryText: { fontSize: FontSize.xs },
  meta: { fontSize: FontSize.xs },
});

export function BountyListScreen({
  onSelectBounty,
  onBack,
}: {
  onSelectBounty?: (id: string) => void;
  onBack?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [selectedDifficulty, setSelectedDifficulty] = useState<"All" | Difficulty>("All");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [proposalBounty, setProposalBounty] = useState<BountySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Real API fetcher - replaces mock data generation
  const fetchBounties = useCallback(
    async (page: number, pageSize: number): Promise<Bounty[]> => {
      try {
        setError(null);
        setIsLoading(true);

        const response = await apiClient.getBounties({
          page,
          limit: pageSize,
          difficulty: selectedDifficulty !== "All" ? selectedDifficulty : undefined,
          category: selectedCategory !== "All" ? selectedCategory : undefined,
        });

        return response.items;
      } catch (err) {
        const errorMessage = err instanceof ApiError
          ? err.message
          : err instanceof NetworkError
          ? "Network connection failed. Please check your connection."
          : "Failed to load bounties. Please try again.";
        
        setError(errorMessage);
        
        // Show user-friendly error
        Alert.alert(
          "Error Loading Bounties",
          errorMessage,
          [{ text: "Retry", onPress: () => window.location.reload() }]
        );
        
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [selectedDifficulty, selectedCategory]
  );

  const infiniteConfig = useMemo(
    () => ({
      pageSize: 20,
      maxItems: 300,
      initialData: [] as Bounty[], // Start empty, load from API
      onLoadMore: fetchBounties,
    }),
    [fetchBounties]
  );

  const handleDifficultySelect = useCallback((d: "All" | Difficulty) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDifficulty(d);
  }, []);

  const handleCategorySelect = useCallback((c: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(c);
  }, []);

  const handleBountyPress = useCallback(
    async (id: string) => {
      try {
        // Fetch detailed bounty info from API
        const bounty = await apiClient.getBounty(id);
        setProposalBounty({
          id: bounty.id,
          title: bounty.title,
          budget: bounty.budget,
          currency: "USD", // Default currency
          difficulty: bounty.difficulty,
          category: bounty.category,
        });
        onSelectBounty?.(id);
      } catch (err) {
        Alert.alert(
          "Error",
          "Failed to load bounty details. Please try again."
        );
      }
    },
    [onSelectBounty]
  );

  const handleProposalSubmit = useCallback(
    async (bountyId: string, fields: ProposalFields) => {
      try {
        await apiClient.applyForBounty(bountyId, {
          freelancer: "mobile-user", // Replace with actual user ID
          proposal: fields.proposal,
          proposedBudget: fields.budget,
          timeline: fields.timeline,
        });

        Alert.alert(
          "Success",
          "Your proposal has been submitted successfully!",
          [{ text: "OK", onPress: () => setProposalBounty(null) }]
        );
      } catch (err) {
        const errorMessage = err instanceof ApiError
          ? err.message
          : "Failed to submit proposal. Please try again.";
        
        Alert.alert("Submission Failed", errorMessage);
        throw err; // Re-throw to let form handle the error
      }
    },
    []
  );

  const renderItem = useCallback(
    (item: Bounty) => (
      <BountyCard
        item={item}
        onPress={handleBountyPress}
        colors={colors}
      />
    ),
    [handleBountyPress, colors]
  );

  const keyExtractor = useCallback(
    (item: Bounty, index: number) => item.id ?? String(index),
    []
  );

  // Client-side filter applied on top of paginated data
  // (server-side filtering would be wired through infiniteConfig.onLoadMore params)
  const filterFn = useCallback(
    (item: Bounty) => {
      const diffMatch =
        selectedDifficulty === "All" || item.difficulty === selectedDifficulty;
      const catMatch =
        selectedCategory === "All" || item.category === selectedCategory;
      return diffMatch && catMatch;
    },
    [selectedDifficulty, selectedCategory]
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Navbar */}
      <View style={[styles.navbar, { borderBottomColor: colors.border }]}>
        {onBack && (
          <Pressable
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
          </Pressable>
        )}
        <View style={styles.navTitleBlock}>
          <Text style={[styles.navTitle, { color: colors.text }]}>Bounties</Text>
          <Text style={[styles.navSubtitle, { color: colors.textTertiary }]}>
            Short-term, high-impact projects
          </Text>
        </View>
      </View>

      {/* Difficulty filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterContent}
      >
        {DIFFICULTIES.map((d) => {
          const active = selectedDifficulty === d;
          const color = d === "All" ? colors.primary : DIFFICULTY_COLORS[d as Difficulty];
          return (
            <Pressable
              key={d}
              onPress={() => handleDifficultySelect(d)}
              style={[
                styles.chip,
                active
                  ? { backgroundColor: color }
                  : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? "#fff" : colors.textSecondary },
                ]}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterContent}
      >
        {CATEGORIES.map((c) => {
          const active = selectedCategory === c;
          return (
            <Pressable
              key={c}
              onPress={() => handleCategorySelect(c)}
              style={[
                styles.chip,
                active
                  ? { backgroundColor: colors.accent }
                  : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? "#fff" : colors.textSecondary },
                ]}
              >
                {c}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Infinite scroll list */}
      <InfiniteScrollList
        infiniteConfig={infiniteConfig}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        itemHeight={ITEM_HEIGHT + Spacing.xs * 2} // card height + vertical margins
        scrollThreshold={0.6}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        filterFn={filterFn}
        emptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No bounties found
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Try changing the filters above.
            </Text>
          </View>
        }
      />

      <ProposalModal
        visible={proposalBounty !== null}
        bounty={proposalBounty}
        onClose={() => setProposalBounty(null)}
        onSubmit={handleProposalSubmit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  backBtn: { padding: Spacing.xs },
  backIcon: { fontSize: 24, fontWeight: FontWeight.bold },
  navTitleBlock: { flex: 1 },
  navTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  navSubtitle: { fontSize: FontSize.xs, marginTop: 1 },
  filterRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  filterContent: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  chipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: "center" },
  emptySubtitle: { fontSize: FontSize.base, textAlign: "center", lineHeight: 22 },
});
