/**
 * FreelancerDirectoryScreen — Issue #544
 * "Establish the specific standard Freelancer directory browsing experience"
 *
 * Features:
 *  - Search bar with real-time filtering (name, bio, skills)
 *  - Discipline filter chips (horizontally scrollable)
 *  - Freelancer cards with avatar, discipline badge, stats, skills preview
 *  - Availability indicator per card
 *  - Rating display per card
 *  - FlatList with optimised rendering (getItemLayout, removeClippedSubviews)
 *  - Empty state with clear-filters CTA
 *  - Offline-first via useOfflineData
 *  - Pull-to-refresh
 *  - Full dark mode via useTheme()
 *  - Zero frame drops: memoised renderItem + keyExtractor
 *  - Accessibility labels throughout
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
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
import { useOfflineData } from "../hooks/useOfflineData";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";

// ─── Domain types ─────────────────────────────────────────────────────────────

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

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_FREELANCERS: Freelancer[] = [
  {
    id: "alex-studio",
    name: "Alex Chen",
    title: "Product Designer",
    discipline: "UI/UX Design",
    bio: "Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.",
    skills: ["Figma", "Design Systems", "Prototyping", "User Research"],
    stats: { projects: 48, clients: 22, experience: 8 },
    hourlyRate: 120,
    availability: "available",
    rating: 4.9,
    reviewCount: 37,
    responseTime: "2 hours",
  },
  {
    id: "maya-writes",
    name: "Maya Patel",
    title: "Content Strategist & Writer",
    discipline: "Writing",
    bio: "Creating compelling narratives and strategic content that drives engagement. Expertise in brand storytelling and technical writing.",
    skills: ["Content Strategy", "Copywriting", "Technical Writing", "SEO"],
    stats: { projects: 60, clients: 25, experience: 10 },
    hourlyRate: 95,
    availability: "limited",
    rating: 4.8,
    reviewCount: 52,
    responseTime: "4 hours",
  },
  {
    id: "jordan-creative",
    name: "Jordan Maxwell",
    title: "Creative Director",
    discipline: "Content Creation",
    bio: "Producing high-impact visual and multimedia content. Known for creative campaigns that generate millions of impressions.",
    skills: ["Video Production", "Photography", "Motion Design", "Copywriting"],
    stats: { projects: 80, clients: 35, experience: 12 },
    hourlyRate: 150,
    availability: "available",
    rating: 5.0,
    reviewCount: 28,
    responseTime: "1 hour",
  },
  {
    id: "sophia-ux",
    name: "Sophia Rodriguez",
    title: "UX Researcher & Designer",
    discipline: "UI/UX Design",
    bio: "Data-driven designer focused on research-backed solutions. Passion for accessibility and inclusive design practices.",
    skills: [
      "User Research",
      "Usability Testing",
      "Wireframing",
      "Accessibility",
    ],
    stats: { projects: 35, clients: 18, experience: 7 },
    hourlyRate: 110,
    availability: "unavailable",
    rating: 4.7,
    reviewCount: 19,
    responseTime: "6 hours",
  },
  {
    id: "marcus-brand",
    name: "Marcus Williams",
    title: "Brand Strategist",
    discipline: "Brand Strategy",
    bio: "Building memorable brands from the ground up. Specialised in positioning, identity, and go-to-market strategy for startups.",
    skills: ["Brand Identity", "Positioning", "Market Research", "Naming"],
    stats: { projects: 42, clients: 30, experience: 9 },
    hourlyRate: 130,
    availability: "available",
    rating: 4.6,
    reviewCount: 24,
    responseTime: "3 hours",
  },
  {
    id: "priya-marketing",
    name: "Priya Sharma",
    title: "Growth Marketing Lead",
    discipline: "Marketing",
    bio: "Driving measurable growth through data-driven campaigns. Expert in paid acquisition, email, and conversion optimisation.",
    skills: ["Growth Marketing", "Paid Ads", "Email Marketing", "Analytics"],
    stats: { projects: 55, clients: 28, experience: 11 },
    hourlyRate: 105,
    availability: "limited",
    rating: 4.8,
    reviewCount: 41,
    responseTime: "2 hours",
  },
];

const DISCIPLINES = [
  "All",
  "UI/UX Design",
  "Writing",
  "Content Creation",
  "Brand Strategy",
  "Marketing",
  "Product Management",
];

async function fetchFreelancers(): Promise<Freelancer[]> {
  await new Promise((r) => setTimeout(r, 500));
  return MOCK_FREELANCERS;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVAILABILITY_CONFIG = {
  available: { label: "Available", color: "#22c55e" },
  limited: { label: "Limited", color: "#f59e0b" },
  unavailable: { label: "Busy", color: "#ef4444" },
} as const;

const CARD_HEIGHT = 200; // approximate, for getItemLayout

// ─── Freelancer card ──────────────────────────────────────────────────────────

interface FreelancerCardProps {
  freelancer: Freelancer;
  onPress: (id: string) => void;
}

function FreelancerCard({ freelancer, onPress }: FreelancerCardProps) {
  const { colors } = useTheme();
  const avail = freelancer.availability
    ? AVAILABILITY_CONFIG[freelancer.availability]
    : null;

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(freelancer.id);
  }, [freelancer.id, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        cardStyles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${freelancer.name}, ${freelancer.title}`}
    >
      {/* Header row */}
      <View style={cardStyles.header}>
        {/* Avatar */}
        <View style={[cardStyles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={cardStyles.avatarInitial}>
            {freelancer.name.charAt(0)}
          </Text>
        </View>

        {/* Name + title */}
        <View style={cardStyles.nameBlock}>
          <Text
            style={[cardStyles.name, { color: colors.text }]}
            numberOfLines={1}
          >
            {freelancer.name}
          </Text>
          <Text
            style={[cardStyles.title, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {freelancer.title}
          </Text>
          {/* Discipline badge */}
          <View
            style={[
              cardStyles.badge,
              { backgroundColor: colors.accent + "22" },
            ]}
          >
            <Text style={[cardStyles.badgeText, { color: colors.accent }]}>
              {freelancer.discipline}
            </Text>
          </View>
        </View>

        {/* Rate + availability */}
        <View style={cardStyles.rateBlock}>
          {freelancer.hourlyRate && (
            <Text style={[cardStyles.rate, { color: colors.primary }]}>
              ${freelancer.hourlyRate}
              <Text
                style={[cardStyles.rateUnit, { color: colors.textTertiary }]}
              >
                /h
              </Text>
            </Text>
          )}
          {avail && (
            <View
              style={[
                cardStyles.availBadge,
                { backgroundColor: avail.color + "22" },
              ]}
            >
              <View
                style={[cardStyles.availDot, { backgroundColor: avail.color }]}
              />
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
        {freelancer.bio}
      </Text>

      {/* Stats row */}
      {freelancer.stats && (
        <View style={[cardStyles.statsRow, { borderTopColor: colors.border }]}>
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {freelancer.stats.projects}
            </Text>
            <Text
              style={[cardStyles.statLabel, { color: colors.textTertiary }]}
            >
              Projects
            </Text>
          </View>
          <View
            style={[cardStyles.statDivider, { backgroundColor: colors.border }]}
          />
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {freelancer.stats.clients}
            </Text>
            <Text
              style={[cardStyles.statLabel, { color: colors.textTertiary }]}
            >
              Clients
            </Text>
          </View>
          <View
            style={[cardStyles.statDivider, { backgroundColor: colors.border }]}
          />
          <View style={cardStyles.statCell}>
            <Text style={[cardStyles.statValue, { color: colors.text }]}>
              {freelancer.stats.experience}y
            </Text>
            <Text
              style={[cardStyles.statLabel, { color: colors.textTertiary }]}
            >
              Exp.
            </Text>
          </View>
          {freelancer.rating != null && (
            <>
              <View
                style={[
                  cardStyles.statDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <View style={cardStyles.statCell}>
                <Text
                  style={[cardStyles.statValue, { color: colors.starFilled }]}
                >
                  ★ {freelancer.rating.toFixed(1)}
                </Text>
                <Text
                  style={[cardStyles.statLabel, { color: colors.textTertiary }]}
                >
                  {freelancer.reviewCount} reviews
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Skills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={cardStyles.skillsScroll}
      >
        <View style={cardStyles.skillsRow}>
          {freelancer.skills.slice(0, 5).map((skill) => (
            <View
              key={skill}
              style={[
                cardStyles.skillChip,
                { backgroundColor: colors.surfaceElevated },
              ]}
            >
              <Text
                style={[cardStyles.skillText, { color: colors.textSecondary }]}
              >
                {skill}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.sm,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
    ...Shadow.sm,
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
  rateUnit: { fontSize: FontSize.xs, fontWeight: FontWeight.regular },
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
  skillsScroll: { marginTop: 2 },
  skillsRow: { flexDirection: "row", gap: Spacing.xs },
  skillChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  skillText: { fontSize: FontSize.xs },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export interface FreelancerDirectoryScreenProps {
  onSelectFreelancer?: (id: string) => void;
  onBack?: () => void;
}

export function FreelancerDirectoryScreen({
  onSelectFreelancer,
  onBack,
}: FreelancerDirectoryScreenProps) {
  const { colors, isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDiscipline, setSelectedDiscipline] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: freelancers,
    isLoading,
    isStale,
    cachedAt,
    refetch,
  } = useOfflineData<Freelancer[]>("freelancer-directory", fetchFreelancers, {
    ttlMs: 5 * 60 * 1000,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleDisciplineSelect = useCallback((discipline: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDiscipline(discipline);
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedDiscipline("All");
  }, []);

  // ── Filtered list ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!freelancers) return [];
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

  // ── FlatList helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: Freelancer }) => (
      <FreelancerCard
        freelancer={item}
        onPress={onSelectFreelancer ?? (() => {})}
      />
    ),
    [onSelectFreelancer],
  );

  const keyExtractor = useCallback((item: Freelancer) => item.id, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: CARD_HEIGHT + Spacing.sm,
      offset: (CARD_HEIGHT + Spacing.sm) * index,
      index,
    }),
    [],
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
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
        >
          <Text style={emptyStyles.btnText}>Clear Filters</Text>
        </Pressable>
      </View>
    ),
    [colors, handleClearFilters],
  );

  const ListHeaderComponent = useMemo(
    () => (
      <View style={headerStyles.wrap}>
        {isStale && cachedAt && (
          <View
            style={[
              headerStyles.staleBanner,
              { backgroundColor: colors.warning + "22" },
            ]}
          >
            <Text style={[headerStyles.staleText, { color: colors.warning }]}>
              ⚠️ Showing cached data from {cachedAt.toLocaleTimeString()}
            </Text>
          </View>
        )}
        <Text
          style={[headerStyles.resultCount, { color: colors.textTertiary }]}
        >
          {filtered.length} freelancer{filtered.length !== 1 ? "s" : ""}
        </Text>
      </View>
    ),
    [filtered.length, isStale, cachedAt, colors],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Nav bar */}
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
        {isLoading && !refreshing && (
          <ActivityIndicator color={colors.primary} size="small" />
        )}
      </View>

      {/* Search bar */}
      <View
        style={[
          styles.searchWrap,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
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
            placeholder="Search by name, skills, or expertise…"
            placeholderTextColor={colors.placeholder}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search freelancers"
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery("")}
              accessibilityLabel="Clear search"
            >
              <Text style={[styles.clearBtn, { color: colors.textTertiary }]}>
                ✕
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Discipline filter chips */}
      <View style={[styles.filterWrap, { borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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
                accessibilityLabel={`Filter by ${d}`}
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
      </View>

      {/* List */}
      {isLoading && !freelancers ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading freelancers…
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={10}
          initialNumToRender={5}
          ListHeaderComponent={ListHeaderComponent}
          ListEmptyComponent={ListEmptyComponent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          accessibilityLabel="Freelancer directory list"
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    paddingVertical: Spacing.xs,
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
  listContent: { paddingTop: Spacing.sm, paddingBottom: Spacing["4xl"] },
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  loadingText: { fontSize: FontSize.base },
});

const headerStyles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xs },
  staleBanner: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    marginBottom: Spacing.xs,
  },
  staleText: { fontSize: FontSize.xs },
  resultCount: { fontSize: FontSize.sm },
});

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingTop: Spacing["4xl"],
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
