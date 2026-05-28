import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PortfolioSummary } from "../../types";
import { useTheme } from "../../theme/ThemeProvider";
import {
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Spacing,
} from "../../theme/tokens";

interface PortfolioCardProps {
  portfolio: PortfolioSummary;
  onPress: () => void;
}

export function PortfolioCard({ portfolio, onPress }: PortfolioCardProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
        Shadow.sm,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open portfolio ${portfolio.title}`}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {portfolio.title}
        </Text>
        <Text style={[styles.score, { color: colors.success }]}>
          +{portfolio.change}%
        </Text>
      </View>

      <Text
        style={[styles.subtitle, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {portfolio.subtitle}
      </Text>

      <Text style={[styles.creator, { color: colors.textTertiary }]}>
        by {portfolio.creator}
      </Text>

      <View style={styles.statsRow}>
        <View style={styles.metricGroup}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {portfolio.value}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
            Assets
          </Text>
        </View>
        <View style={styles.metricGroup}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {portfolio.followers}k
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
            Followers
          </Text>
        </View>
      </View>

      <View style={styles.tagRow}>
        {portfolio.tags.map((tag) => (
          <View
            key={tag}
            style={[styles.tag, { backgroundColor: colors.primaryLight }]}
          >
            <Text style={[styles.tagText, { color: colors.primary }]}>
              {tag}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.md,
    marginRight: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    flex: 1,
  },
  score: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  creator: {
    fontSize: FontSize.xs,
    marginBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  metricGroup: {
    flex: 1,
  },
  metricValue: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.extrabold,
  },
  metricLabel: {
    fontSize: FontSize.xs,
    marginTop: 4,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },
  tag: {
    borderRadius: Radius.full,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    marginVertical: Spacing.xs,
    marginHorizontal: 4,
  },
  tagText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
});
