import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeProvider";
import { useOfflineData } from "../hooks/useOfflineData";
import {
  PortfolioSummary,
  ProjectBountyItem,
  HomeData,
  RootStackParamList,
} from "../types";
import { MetricCard } from "../components/dashboard/MetricCard";
import { PortfolioCard } from "../components/home/PortfolioCard";
import { ProjectBountyList } from "../components/home/ProjectBountyList";
import { ActionButton } from "../components/buttons/ActionButton";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

const buildHomeData = (): HomeData => ({
  trendingPortfolios: [
    {
      id: "p1",
      title: "Aurora NFT Launch",
      subtitle: "Fast-growing digital art portfolio with design-first UX.",
      creator: "Luna Arts",
      value: "14.8k",
      followers: 28,
      change: 18,
      tags: ["NFT", "Art", "Brand"],
    },
    {
      id: "p2",
      title: "Crypto Creator Growth",
      subtitle: "High-conversion crypto campaigns optimized for creators.",
      creator: "Stellar Labs",
      value: "9.7k",
      followers: 16,
      change: 23,
      tags: ["Crypto", "Growth", "Marketing"],
    },
    {
      id: "p3",
      title: "Product Launch Suite",
      subtitle: "Bounty-backed launch systems for early-stage founders.",
      creator: "LaunchPad",
      value: "12.4k",
      followers: 21,
      change: 12,
      tags: ["Launch", "Product", "Bounty"],
    },
  ],
  quickMetrics: [
    {
      id: "m1",
      label: "Trending Portfolios",
      value: 14,
      previousValue: 9,
      unit: "",
      trend: "up",
      trendPct: 55.6,
    },
    {
      id: "m2",
      label: "Active Bounties",
      value: 7,
      previousValue: 5,
      unit: "",
      trend: "up",
      trendPct: 40.0,
    },
    {
      id: "m3",
      label: "Portfolio Views",
      value: 32,
      previousValue: 21,
      unit: "k",
      trend: "up",
      trendPct: 52.4,
    },
    {
      id: "m4",
      label: "Conversion Rate",
      value: 4.8,
      previousValue: 4.1,
      unit: "%",
      trend: "up",
      trendPct: 17.1,
    },
  ],
  projectBountyItems: [
    {
      id: "j1",
      kind: "project",
      title: "Creator Marketplace Redesign",
      subtitle: "Refine onboarding and highlight creator stories.",
      reward: "850 XLM",
      due: "3 days left",
      status: "Live",
      tags: ["Web", "Design"],
    },
    {
      id: "j2",
      kind: "bounty",
      title: "Brand identity for DeFi product",
      subtitle: "Design visual system for token launch campaign.",
      reward: "450 XLM",
      due: "1 day left",
      status: "Closing",
      tags: ["Brand", "Finance"],
    },
    {
      id: "j3",
      kind: "project",
      title: "Mobile campaign for creator growth",
      subtitle: "Launch mobile-first acquisition funnel.",
      reward: "1,200 XLM",
      due: "6 days left",
      status: "Live",
      tags: ["Mobile", "Growth"],
    },
    {
      id: "j4",
      kind: "bounty",
      title: "Illustration suite for influencer pack",
      subtitle: "Create assets for social push and creator events.",
      reward: "380 XLM",
      due: "2 days left",
      status: "Live",
      tags: ["Illustration", "Social"],
    },
  ],
});

async function fetchHomeData(): Promise<HomeData> {
  await new Promise((resolve) => setTimeout(resolve, 520));
  return buildHomeData();
}

export function HomeScreen() {
  const { colors, isDark } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, isStale, cachedAt, refetch } =
    useOfflineData<HomeData>("home-screen-data", fetchHomeData, {
      ttlMs: 5 * 60 * 1000,
    });
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const onPortfolioPress = useCallback((portfolio: PortfolioSummary) => {
    Haptics.selectionAsync();
    // Placeholder for deeper portfolio details.
  }, []);

  const onItemSelect = useCallback((item: ProjectBountyItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Placeholder for project / bounty detail navigation.
  }, []);

  const trendingSection = useMemo(() => {
    if (!data) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Trending portfolios
          </Text>
          <Text
            style={[styles.sectionCaption, { color: colors.textSecondary }]}
          >
            Selected from top user activity.
          </Text>
        </View>
        <FlatList
          data={data.trendingPortfolios}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PortfolioCard
              portfolio={item}
              onPress={() => onPortfolioPress(item)}
            />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ListFooterComponent={<View style={{ width: Spacing.base }} />}
        />
      </View>
    );
  }, [data, colors.text, colors.textSecondary, onPortfolioPress]);

  const metricsSection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={styles.metricsGrid}>
        {data.quickMetrics.map((metric) => (
          <MetricCard
            key={metric.id}
            metric={metric}
            style={styles.metricCell}
          />
        ))}
      </View>
    );
  }, [data]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              Hello, Stellar Creator
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Track trending portfolios, project demand, and secure your session
              with biometric access.
            </Text>
          </View>
          <View style={styles.heroActions}>
            <ActionButton
              title="Use Biometrics"
              onPress={() => navigation.navigate("BiometricAuth")}
              variant="primary"
              accessibilityLabel="Open biometric authentication screen"
            />
            <ActionButton
              title="Refresh"
              onPress={handleRefresh}
              variant="secondary"
              accessibilityLabel="Refresh home content"
            />
          </View>
        </View>

        {isStale && cachedAt && (
          <View
            style={[
              styles.staleBadge,
              {
                backgroundColor: colors.warningLight,
                borderColor: colors.warning,
              },
            ]}
          >
            <Text style={[styles.staleText, { color: colors.warning }]}>
              Cached data from {cachedAt.toLocaleTimeString()}
            </Text>
          </View>
        )}

        {isLoading && !data ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading portfolio analytics…
            </Text>
          </View>
        ) : (
          <>
            {metricsSection}
            {trendingSection}
            <ProjectBountyList
              items={data?.projectBountyItems ?? []}
              title="Project & Bounty feed"
              onSelect={onItemSelect}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing["3xl"],
  },
  hero: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  heroActions: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  staleBadge: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  staleText: {
    fontSize: FontSize.xs,
    textAlign: "center",
  },
  loadingWrapper: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  sectionCaption: {
    fontSize: FontSize.xs,
  },
  horizontalList: {
    paddingVertical: Spacing.sm,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  metricCell: {
    width: "48%",
    marginBottom: Spacing.sm,
  },
});
