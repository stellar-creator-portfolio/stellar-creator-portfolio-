/**
 * BountyListScreen — Infinite-scrolling bounty marketplace
 *
 * Uses InfiniteScrollList (FlatList-based) with:
 *  - Memory-capped pagination (maxItems: 300)
 *  - Pull-to-refresh
 *  - Difficulty + category filter chips
 *  - Zero frame drops via getItemLayout (fixed item height)
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { InfiniteScrollList } from "../components/InfiniteScrollList";
import { ProposalModal, BountySummary } from "../components/ProposalModal";
import { ProposalFields } from "../hooks/useProposalForm";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";
type BountyStatus = "open" | "in-progress" | "completed";

interface Bounty {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: string;
  difficulty: Difficulty;
  category: string;
  tags: string[];
  applicants: number;
  status: BountyStatus;
  requiredSkills: string[];
}

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

const ITEM_HEIGHT = 168; // fixed height enables getItemLayout optimisation

// ─── Mock data ────────────────────────────────────────────────────────────────

const CATEGORIES_DATA = [
  "UI/UX Design",
  "Writing",
  "Marketing",
  "Brand Strategy",
  "Product Management",
];

const SKILLS_POOL = [
  "Figma",
  "Copywriting",
  "SEO",
  "Analytics",
  "Branding",
  "Research",
];

function generateBounties(count: number, offset = 0): Bounty[] {
  const difficulties: Difficulty[] = [
    "beginner",
    "intermediate",
    "advanced",
    "expert",
  ];
  return Array.from({ length: count }, (_, i) => {
    const idx = offset + i;
    const diff = difficulties[idx % difficulties.length];
    return {
      id: `bounty-${idx}`,
      title: `Bounty #${idx + 1}: ${CATEGORIES_DATA[idx % CATEGORIES_DATA.length]} Project`,
      description:
        "Looking for an experienced professional to deliver high-quality work within the specified timeline.",
      budget: 500 + (idx % 20) * 250,
      currency: "USD",
      deadline: new Date(Date.now() + (7 + (idx % 21)) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      difficulty: diff,
      category: CATEGORIES_DATA[idx % CATEGORIES_DATA.length],
      tags: SKILLS_POOL.slice(idx % SKILLS_POOL.length, (idx % SKILLS_POOL.length) + 2),
      applicants: idx % 15,
      status: "open",
      requiredSkills: SKILLS_POOL.slice(
        (idx + 1) % SKILLS_POOL.length,
        ((idx + 1) % SKILLS_POOL.length) + 3
      ),
    };
  });
}

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

// ─── Screen ───────────────────────────────────────────────────────────────────

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

  // Simulated async fetcher — replace with real API call
  const fetchBounties = useCallback(
    async (page: number, pageSize: number): Promise<Bounty[]> => {
      await new Promise((r) => setTimeout(r, 350));
      return generateBounties(pageSize, (page - 1) * pageSize);
    },
    []
  );

  const infiniteConfig = useMemo(
    () => ({
      pageSize: 20,
      maxItems: 300, // cap memory at 300 items
      initialData: generateBounties(20),
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

  // Open proposal modal instead of navigating away
  const handleBountyPress = useCallback(
    (id: string) => {
      // Find the bounty from the generated data to build the summary
      // In production this would come from the paginated data store
      const idx = parseInt(id.replace("bounty-", ""), 10);
      const bounties = generateBounties(1, idx);
      if (bounties[0]) {
        setProposalBounty({
          id: bounties[0].id,
          title: bounties[0].title,
          budget: bounties[0].budget,
          currency: bounties[0].currency,
          difficulty: bounties[0].difficulty,
          category: bounties[0].category,
        });
      }
      onSelectBounty?.(id);
    },
    [onSelectBounty]
  );

  const handleProposalSubmit = useCallback(
    async (bountyId: string, fields: ProposalFields) => {
      // Replace with real API call: POST /api/bounties/:id/apply
      await new Promise((r) => setTimeout(r, 800));
      // Throw on error: throw new Error("Server error message")
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
