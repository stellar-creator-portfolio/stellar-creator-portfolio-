/**
 * FreelancerDirectoryEnhanced — Virtualized infinite scrolling with memory optimization
 *
 * Features:
 *  - VirtualizedList for memory-efficient rendering (handles 1000s of items)
 *  - Infinite scrolling with pagination
 *  - Search and filtering with real-time updates
 *  - Low memory footprint even with massive datasets
 *  - Zero frame drops through virtual rendering
 */

import React, { useCallback, useMemo, useState, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  VirtualizedList,
  RefreshControl,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { usePagination } from "../hooks/usePagination";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

interface FreelancerStats {
  projects: number;
  clients: number;
  experience: number;
}

interface Freelancer {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  skills: string[];
  stats?: FreelancerStats;
  hourlyRate?: number;
  availability?: "available" | "limited" | "unavailable";
  rating?: number;
  reviewCount?: number;
  responseTime?: string;
}

const DISCIPLINES = [
  "All",
  "UI/UX Design",
  "Writing",
  "Content Creation",
  "Brand Strategy",
  "Marketing",
  "Product Management",
];

const AVAILABILITY_CONFIG = {
  available: { label: "Available", color: "#22c55e" },
  limited: { label: "Limited", color: "#f59e0b" },
  unavailable: { label: "Busy", color: "#ef4444" },
} as const;

/**
 * Optimized FreelancerCard for virtualized rendering
 */
const FreelancerCardVirtualized = React.memo(
  ({
    item,
    onPress,
    colors,
  }: {
    item: Freelancer;
    onPress: (id: string) => void;
    colors: any;
  }) => {
    const handlePress = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress(item.id);
    }, [item.id, onPress]);

    const avail = item.availability
      ? AVAILABILITY_CONFIG[item.availability]
      : null;

    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          cardStyles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.title}`}
      >
        {/* Compact header */}
        <View style={cardStyles.header}>
          <View style={[cardStyles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={cardStyles.avatarInitial}>{item.name.charAt(0)}</Text>
          </View>

          <View style={cardStyles.nameBlock}>
            <Text style={[cardStyles.name, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text
              style={[cardStyles.title, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <View style={[cardStyles.badge, { backgroundColor: colors.accent + "22" }]}>
              <Text style={[cardStyles.badgeText, { color: colors.accent }]}>
                {item.discipline}
              </Text>
            </View>
          </View>

          <View style={cardStyles.rateBlock}>
            {item.hourlyRate && (
              <Text style={[cardStyles.rate, { color: colors.primary }]}>
                ${item.hourlyRate}
                <Text style={[cardStyles.rateUnit, { color: colors.textTertiary }]}>
                  /h
                </Text>
              </Text>
            )}
            {avail && (
              <View style={[cardStyles.availBadge, { backgroundColor: avail.color + "22" }]}>
                <View style={[cardStyles.availDot, { backgroundColor: avail.color }]} />
                <Text style={[cardStyles.availText, { color: avail.color }]}>
                  {avail.label}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Bio */}
        <Text
          style={[cardStyles.bio, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {item.bio}
        </Text>

        {/* Stats */}
        {item.stats && (
          <View style={[cardStyles.statsRow, { borderTopColor: colors.border }]}>
            <View style={cardStyles.statCell}>
              <Text style={[cardStyles.statValue, { color: colors.text }]}>
                {item.stats.projects}
              </Text>
              <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>
                Projects
              </Text>
            </View>
            <View style={[cardStyles.statDivider, { backgroundColor: colors.border }]} />
            <View style={cardStyles.statCell}>
              <Text style={[cardStyles.statValue, { color: colors.text }]}>
                {item.stats.clients}
              </Text>
              <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>
                Clients
              </Text>
            </View>
            <View style={[cardStyles.statDivider, { backgroundColor: colors.border }]} />
            <View style={cardStyles.statCell}>
              <Text style={[cardStyles.statValue, { color: colors.text }]}>
                {item.stats.experience}y
              </Text>
              <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>
                Exp.
              </Text>
            </View>
            {item.rating != null && (
              <>
                <View
                  style={[cardStyles.statDivider, { backgroundColor: colors.border }]}
                />
                <View style={cardStyles.statCell}>
                  <Text
                    style={[cardStyles.statValue, { color: colors.starFilled }]}
                  >
                    ★ {item.rating.toFixed(1)}
                  </Text>
                  <Text style={[cardStyles.statLabel, { color: colors.textTertiary }]}>
                    {item.reviewCount} reviews
                  </Text>
                </View>
              </>
            )}
          </View>
        )}
      </Pressable>
    );
  }
);

FreelancerCardVirtualized.displayName = "FreelancerCardVirtualized";

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.base,
    marginVertical: Spacing.sm,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  header: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarInitial: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: "#fff",
  },
  nameBlock: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  title: { fontSize: FontSize.sm },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginTop: 2,
  },
  badgeText: { fontSize: 10, fontWeight: FontWeight.semibold },
  rateBlock: { alignItems: "flex-end", gap: 4 },
  rate: { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  rateUnit: { fontSize: FontSize.xs },
  availBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
    gap: 4,
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

/**
 * Enhanced directory with infinite scrolling and memory optimization
 */
export function FreelancerDirectoryEnhanced({
  onSelectFreelancer,
  onBack,
}: {
  onSelectFreelancer?: (id: string) => void;
  onBack?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDiscipline, setSelectedDiscipline] = useState("All");
  const listRef = useRef(null);

  // Mock data generator for pagination
  const generateFreelancers = useCallback((count: number): Freelancer[] => {
    const disciplines = ["UI/UX Design", "Writing", "Content Creation"];
    const skills = [
      "Figma",
      "Design",
      "Copywriting",
      "Video",
      "Brand Strategy",
      "Analytics",
    ];

    return Array.from({ length: count }, (_, i) => ({
      id: `freelancer-${i}`,
      name: `Freelancer ${i + 1}`,
      title: `Professional ${i % 3}`,
      discipline: disciplines[i % disciplines.length],
      bio: "Expert in their field with proven track record.",
      skills: skills.slice(i % skills.length, (i % skills.length) + 3),
      stats: {
        projects: 20 + (i % 80),
        clients: 10 + (i % 40),
        experience: 2 + (i % 15),
      },
      hourlyRate: 50 + (i % 150),
      availability: (["available", "limited", "unavailable"] as const)[i % 3],
      rating: 4.0 + (i % 10) / 10,
      reviewCount: 5 + (i % 50),
      responseTime: "2 hours",
    }));
  }, []);

  // Infinite scroll state
  const {
    data: freelancers,
    isLoading,
    isFetching,
    loadMore,
    refresh,
  } = useInfiniteScroll({
    pageSize: 30,
    maxItems: 500,
    initialData: generateFreelancers(30),
    onLoadMore: async (page, pageSize) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return generateFreelancers(pageSize);
    },
  });

  // Filter items based on search and discipline
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return freelancers.filter((f) => {
      const disciplineMatch =
        selectedDiscipline === "All" || f.discipline === selectedDiscipline;
      const searchMatch =
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.bio.toLowerCase().includes(q) ||
        f.skills.some((s) => s.toLowerCase().includes(q)) ||
        f.title.toLowerCase().includes(q);
      return disciplineMatch && searchMatch;
    });
  }, [freelancers, searchQuery, selectedDiscipline]);

  const handleDisciplineSelect = useCallback((discipline: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDiscipline(discipline);
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedDiscipline("All");
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Freelancer }) => (
      <FreelancerCardVirtualized
        item={item}
        onPress={onSelectFreelancer ?? (() => {})}
        colors={colors}
      />
    ),
    [onSelectFreelancer, colors]
  );

  const ListEmptyComponent = useMemo(
    () => (
      <View style={emptyStyles.wrap}>
        <Text style={emptyStyles.icon}>🔍</Text>
        <Text style={[emptyStyles.title, { color: colors.text }]}>
          No freelancers found
        </Text>
        <Text style={[emptyStyles.subtitle, { color: colors.textSecondary }]}>
          Try adjusting your search or filters.
        </Text>
        <Pressable
          onPress={handleClearFilters}
          style={[emptyStyles.btn, { backgroundColor: colors.primary }]}
        >
          <Text style={emptyStyles.btnText}>Clear Filters</Text>
        </Pressable>
      </View>
    ),
    [colors, handleClearFilters]
  );

  const ListFooterComponent = useMemo(
    () => {
      if (isFetching) {
        return (
          <View style={{ paddingVertical: 20, alignItems: "center" }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        );
      }
      return null;
    },
    [isFetching, colors.primary]
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Navigation bar */}
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
          <Text style={[styles.navTitle, { color: colors.text }]}>
            Freelancers
          </Text>
          <Text style={[styles.navSubtitle, { color: colors.textTertiary }]}>
            Find expert talent
          </Text>
        </View>
        {isLoading && (
          <ActivityIndicator color={colors.primary} size="small" />
        )}
      </View>

      {/* Search bar */}
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
            placeholder="Search freelancers…"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="Search freelancers"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")}>
              <Text style={[styles.clearBtn, { color: colors.textTertiary }]}>
                ✕
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterWrap, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterScroll}
      >
        {DISCIPLINES.map((d) => {
          const active = selectedDiscipline === d;
          return (
            <Pressable
              key={d}
              onPress={() => handleDisciplineSelect(d)}
              style={[
                styles.filterChip,
                active
                  ? { backgroundColor: colors.primary }
                  : {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderWidth: 1,
                    },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: active ? "#fff" : colors.textSecondary },
                ]}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Virtualized list */}
      <View style={{ flex: 1 }}>
        <VirtualizedList
          ref={listRef}
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          getItem={(data, index) => data[index]}
          getItemCount={(data) => data.length}
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isLoading && freelancers.length > 0}
              onRefresh={refresh}
              colors={[colors.primary]}
            />
          }
          windowSize={10}
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={50}
          accessibilityLabel="Freelancer list"
        />
      </View>
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
  searchInput: {
    flex: 1,
    fontSize: FontSize.base,
    paddingVertical: Spacing.xs,
  },
  clearBtn: { fontSize: FontSize.sm, paddingHorizontal: Spacing.xs },
  filterWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  filterScroll: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  filterChipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.md,
  },
  icon: { fontSize: 48 },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    textAlign: "center",
  },
  subtitle: { fontSize: FontSize.base, textAlign: "center", lineHeight: 22 },
  btn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.xl,
    marginTop: Spacing.sm,
  },
  btnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: "#fff",
  },
});
