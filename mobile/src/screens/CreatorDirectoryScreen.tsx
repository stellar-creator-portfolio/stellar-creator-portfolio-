/**
 * CreatorDirectoryScreen — Memory-efficient creator browser
 *
 * Uses VirtualizedScrollList (VirtualizedList-based) for handling
 * very large datasets with minimal memory footprint:
 *  - Virtual rendering: only visible items are mounted
 *  - maxItems: 400 cap with LRU pruning in useInfiniteScroll
 *  - Discipline filter chips
 *  - Pull-to-refresh
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
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
import { VirtualizedScrollList } from "../components/VirtualizedScrollList";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Creator {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  skills: string[];
  stats: { projects: number; clients: number; experience: number };
  rating?: number;
  reviewCount?: number;
  availability?: "available" | "limited" | "unavailable";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISCIPLINES = [
  "All",
  "UI/UX Design",
  "Writing",
  "Content Creation",
  "Brand Strategy",
  "Marketing",
  "Product Management",
  "Data Analysis",
];

const AVAILABILITY_CONFIG = {
  available: { label: "Available", color: "#22c55e" },
  limited: { label: "Limited", color: "#f59e0b" },
  unavailable: { label: "Busy", color: "#ef4444" },
} as const;

const ITEM_HEIGHT = 148;

// ─── Mock data ────────────────────────────────────────────────────────────────

const DISCIPLINES_DATA = DISCIPLINES.slice(1);
const SKILLS_POOL = ["Figma", "Copywriting", "SEO", "Analytics", "Branding", "Research", "Strategy"];

function generateCreators(count: number, offset = 0): Creator[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = offset + i;
    return {
      id: `creator-${idx}`,
      name: `Creator ${idx + 1}`,
      title: `Senior ${DISCIPLINES_DATA[idx % DISCIPLINES_DATA.length]} Specialist`,
      discipline: DISCIPLINES_DATA[idx % DISCIPLINES_DATA.length],
      bio: "Passionate professional with a proven track record of delivering exceptional results for clients worldwide.",
      skills: SKILLS_POOL.slice(idx % SKILLS_POOL.length, (idx % SKILLS_POOL.length) + 3),
      stats: {
        projects: 15 + (idx % 85),
        clients: 8 + (idx % 42),
        experience: 2 + (idx % 14),
      },
      rating: 4.0 + (idx % 10) / 10,
      reviewCount: 3 + (idx % 47),
      availability: (["available", "limited", "unavailable"] as const)[idx % 3],
    };
  });
}

// ─── CreatorCard ──────────────────────────────────────────────────────────────

const CreatorCard = React.memo(
  ({
    item,
    onPress,
    colors,
  }: {
    item: Creator;
    onPress: (id: string) => void;
    colors: any;
  }) => {
    const handlePress = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress(item.id);
    }, [item.id, onPress]);

    const avail = item.availability ? AVAILABILITY_CONFIG[item.availability] : null;

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
        accessibilityLabel={`${item.name}, ${item.title}`}
      >
        {/* Header */}
        <View style={cardStyles.header}>
          <View style={[cardStyles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={cardStyles.avatarInitial}>{item.name.charAt(0)}</Text>
          </View>

          <View style={cardStyles.nameBlock}>
            <Text style={[cardStyles.name, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[cardStyles.title, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={[cardStyles.disciplineBadge, { backgroundColor: colors.accent + "22" }]}>
              <Text style={[cardStyles.disciplineText, { color: colors.accent }]}>
                {item.discipline}
              </Text>
            </View>
          </View>

          {avail && (
            <View style={[cardStyles.availBadge, { backgroundColor: avail.color + "22" }]}>
              <View style={[cardStyles.availDot, { backgroundColor: avail.color }]} />
              <Text style={[cardStyles.availText, { color: avail.color }]}>
                {avail.label}
              </Text>
            </View>
          )}
        </View>

        {/* Bio */}
        <Text style={[cardStyles.bio, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.bio}
        </Text>

        {/* Stats */}
        <View style={[cardStyles.statsRow, { borderTopColor: colors.border }]}>
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {item.stats.projects}
            </Text>
            <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>Projects</Text>
          </View>
          <View style={[cardStyles.statDivider, { backgroundColor: colors.border }]} />
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {item.stats.clients}
            </Text>
            <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>Clients</Text>
          </View>
          <View style={[cardStyles.statDivider, { backgroundColor: colors.border }]} />
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {item.stats.experience}y
            </Text>
            <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>Exp.</Text>
          </View>
          {item.rating != null && (
            <>
              <View style={[cardStyles.statDivider, { backgroundColor: colors.border }]} />
              <View style={cardStyles.statCell}>
                <Text style={[cardStyles.statValue, { color: "#f59e0b" }]}>
                  ★ {item.rating.toFixed(1)}
                </Text>
                <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>
                  {item.reviewCount}
                </Text>
              </View>
            </>
          )}
        </View>
      </Pressable>
    );
  }
);

CreatorCard.displayName = "CreatorCard";

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.base,
    marginVertical: Spacing.xs,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    justifyContent: "space-between",
  },
  header: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarInitial: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: "#fff" },
  nameBlock: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  title: { fontSize: FontSize.sm },
  disciplineBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginTop: 2,
  },
  disciplineText: { fontSize: 10, fontWeight: FontWeight.semibold },
  availBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
    gap: 4,
    alignSelf: "flex-start",
  },
  availDot: { width: 6, height: 6, borderRadius: 3 },
  availText: { fontSize: 10, fontWeight: FontWeight.semibold },
  bio: { fontSize: FontSize.sm, lineHeight: 18 },
  statsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
  },
  statCell: { flex: 1, alignItems: "center" },
  statDivider: { width: StyleSheet.hairlineWidth },
  statValue: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  statLabel: { fontSize: 10, marginTop: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export function CreatorDirectoryScreen({
  onSelectCreator,
  onBack,
}: {
  onSelectCreator?: (id: string) => void;
  onBack?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDiscipline, setSelectedDiscipline] = useState("All");

  const fetchCreators = useCallback(
    async (page: number, pageSize: number): Promise<Creator[]> => {
      await new Promise((r) => setTimeout(r, 350));
      return generateCreators(pageSize, (page - 1) * pageSize);
    },
    []
  );

  const infiniteConfig = useMemo(
    () => ({
      pageSize: 25,
      maxItems: 400, // VirtualizedList handles large sets; cap memory at 400
      initialData: generateCreators(25),
      onLoadMore: fetchCreators,
    }),
    [fetchCreators]
  );

  const handleDisciplineSelect = useCallback((d: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDiscipline(d);
  }, []);

  const renderItem = useCallback(
    (item: Creator) => (
      <CreatorCard
        item={item}
        onPress={onSelectCreator ?? (() => {})}
        colors={colors}
      />
    ),
    [onSelectCreator, colors]
  );

  const keyExtractor = useCallback(
    (item: Creator, index: number) => item.id ?? String(index),
    []
  );

  // Client-side filter (search + discipline)
  const filterFn = useCallback(
    (item: Creator) => {
      const q = searchQuery.toLowerCase().trim();
      const disciplineMatch =
        selectedDiscipline === "All" || item.discipline === selectedDiscipline;
      const searchMatch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.skills.some((s) => s.toLowerCase().includes(q));
      return disciplineMatch && searchMatch;
    },
    [searchQuery, selectedDiscipline]
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
          <Text style={[styles.navTitle, { color: colors.text }]}>Creators</Text>
          <Text style={[styles.navSubtitle, { color: colors.textTertiary }]}>
            Discover exceptional talent
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: colors.surface }]}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search creators…"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="Search creators"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")}>
              <Text style={[styles.clearBtn, { color: colors.textTertiary }]}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Discipline filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterContent}
      >
        {DISCIPLINES.map((d) => {
          const active = selectedDiscipline === d;
          return (
            <Pressable
              key={d}
              onPress={() => handleDisciplineSelect(d)}
              style={[
                styles.chip,
                active
                  ? { backgroundColor: colors.primary }
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

      {/* Virtualized infinite list */}
      <VirtualizedScrollList
        infiniteConfig={infiniteConfig}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        itemHeight={ITEM_HEIGHT + Spacing.xs * 2}
        windowSize={12}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        filterFn={filterFn}
        emptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👤</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No creators found
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Try adjusting your search or filters.
            </Text>
          </View>
        }
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
  searchWrap: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  searchIcon: { fontSize: FontSize.base },
  searchInput: { flex: 1, fontSize: FontSize.base, paddingVertical: Spacing.xs },
  clearBtn: { fontSize: FontSize.sm, paddingHorizontal: Spacing.xs },
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
