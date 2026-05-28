import React, { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ProjectBountyItem } from "../../types";
import { useTheme } from "../../theme/ThemeProvider";
import {
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Spacing,
} from "../../theme/tokens";

interface ProjectBountyListProps {
  items: ProjectBountyItem[];
  title: string;
  onSelect: (item: ProjectBountyItem) => void;
}

export function ProjectBountyList({
  items,
  title,
  onSelect,
}: ProjectBountyListProps) {
  const { colors } = useTheme();

  const renderItem = ({ item }: { item: ProjectBountyItem }) => (
    <Pressable
      onPress={() => onSelect(item)}
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
      accessibilityLabel={`Open ${item.kind} ${item.title}`}
    >
      <View style={styles.row}>
        <Text
          style={[
            styles.kind,
            {
              backgroundColor:
                item.kind === "project"
                  ? colors.primaryLight
                  : colors.accentLight,
              color: item.kind === "project" ? colors.primary : colors.accent,
            },
          ]}
        >
          {item.kind.toUpperCase()}
        </Text>
        <Text
          style={[
            styles.status,
            {
              color:
                item.status === "Live" ? colors.success : colors.textSecondary,
            },
          ]}
        >
          {" "}
          {item.status}
        </Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {item.title}
      </Text>
      <Text
        style={[styles.subtitle, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {item.subtitle}
      </Text>
      <View style={styles.footer}>
        <Text style={[styles.reward, { color: colors.text }]}>
          {item.reward}
        </Text>
        <Text style={[styles.due, { color: colors.textTertiary }]}>
          {item.due}
        </Text>
      </View>
      <View style={styles.tagsRow}>
        {item.tags.map((tag) => (
          <View
            key={tag}
            style={[styles.tag, { backgroundColor: colors.surfaceElevated }]}
          >
            <Text style={[styles.tagText, { color: colors.textSecondary }]}>
              {tag}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );

  const keyExtractor = useMemo(() => (item: ProjectBountyItem) => item.id, []);

  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: colors.text }]}>{title}</Text>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        scrollEnabled={false}
        removeClippedSubviews
        initialNumToRender={4}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.lg,
  },
  heading: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.sm,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  kind: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    overflow: "hidden",
  },
  status: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  reward: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  due: {
    fontSize: FontSize.xs,
  },
  tagsRow: {
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
  },
  separator: {
    height: Spacing.sm,
  },
});
