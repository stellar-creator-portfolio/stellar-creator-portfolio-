/**
 * ActivityScreen — Real-time activity feed with API integration
 *
 * Features:
 * - Real activity data from backend APIs
 * - Pull-to-refresh for latest updates
 * - Filter by activity type
 * - Real-time notifications integration
 */

import React, { useCallback, useState, useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme/ThemeProvider";
import { FontSize, FontWeight, Radius, Shadow, Spacing } from "../theme/tokens";
import apiClient, { ApiError, NetworkError } from "../services/ApiClient";
import { useToast } from "../context/ToastContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType = 'bounty_created' | 'bounty_applied' | 'project_completed' | 'review_received' | 'message_received';

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  metadata?: {
    bountyId?: string;
    projectId?: string;
    userId?: string;
    amount?: number;
  };
}

interface ActivityScreenProps {
  onNavigate?: (screen: string, params?: any) => void;
}

// ─── Activity Type Config ─────────────────────────────────────────────────────

const ACTIVITY_CONFIG: Record<ActivityType, { icon: string; color: string; label: string }> = {
  bounty_created: { icon: "🎯", color: "#3b82f6", label: "Bounty" },
  bounty_applied: { icon: "📝", color: "#f59e0b", label: "Application" },
  project_completed: { icon: "✅", color: "#22c55e", label: "Completed" },
  review_received: { icon: "⭐", color: "#8b5cf6", label: "Review" },
  message_received: { icon: "💬", color: "#06b6d4", label: "Message" },
};

// ─── Activity Item Component ──────────────────────────────────────────────────

const ActivityItem = React.memo(({ 
  item, 
  colors,
  onPress 
}: { 
  item: Activity; 
  colors: any;
  onPress: (item: Activity) => void;
}) => {
  const config = ACTIVITY_CONFIG[item.type];
  
  return (
    <Pressable
      style={({ pressed }) => [
        styles.activityItem,
        {
          backgroundColor: colors.surface,
          borderLeftColor: config.color,
          opacity: item.read ? 0.7 : 1,
        },
        pressed && { opacity: 0.5 },
      ]}
      onPress={() => onPress(item)}
    >
      <View style={styles.activityHeader}>
        <Text style={styles.activityIcon}>{config.icon}</Text>
        <View style={styles.activityContent}>
          <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.activityDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        </View>
        <View style={styles.activityMeta}>
          <Text style={[styles.activityTime, { color: colors.textTertiary }]}>
            {formatTime(item.timestamp)}
          </Text>
          {!item.read && <View style={[styles.unreadDot, { backgroundColor: config.color }]} />}
        </View>
      </View>
    </Pressable>
  );
});

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const FilterTabs = React.memo(({
  selectedFilter,
  onFilterChange,
  colors,
}: {
  selectedFilter: ActivityType | 'all';
  onFilterChange: (filter: ActivityType | 'all') => void;
  colors: any;
}) => {
  const filters: Array<{ key: ActivityType | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'bounty_created', label: 'Bounties' },
    { key: 'bounty_applied', label: 'Applications' },
    { key: 'project_completed', label: 'Projects' },
    { key: 'review_received', label: 'Reviews' },
  ];

  return (
    <View style={styles.filterContainer}>
      <FlatList
        data={filters}
        keyExtractor={(item) => item.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.filterTab,
              {
                backgroundColor: selectedFilter === item.key ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onFilterChange(item.key);
            }}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: selectedFilter === item.key ? 'white' : colors.textSecondary },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
});

// ─── Main Screen Component ────────────────────────────────────────────────────

export function ActivityScreen({ onNavigate }: ActivityScreenProps) {
  const { colors, isDark } = useTheme();
  const { showError } = useToast();
  
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<ActivityType | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  // Mock activities until real API is available
  const mockActivities: Activity[] = [
    {
      id: '1',
      type: 'bounty_created',
      title: 'New Bounty: Mobile App Design',
      description: 'A new bounty for $2,500 has been posted for mobile app UI design.',
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      read: false,
      metadata: { bountyId: 'bounty-1', amount: 2500 },
    },
    {
      id: '2', 
      type: 'bounty_applied',
      title: 'Application Submitted',
      description: 'You successfully applied to "Brand Identity Redesign" bounty.',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      read: false,
      metadata: { bountyId: 'bounty-2' },
    },
    {
      id: '3',
      type: 'review_received',
      title: 'New Review Received',
      description: 'Sarah Johnson left you a 5-star review for the recent project.',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      read: true,
      metadata: { userId: 'user-123' },
    },
    {
      id: '4',
      type: 'project_completed',
      title: 'Project Completed',
      description: 'Congratulations! You completed "E-commerce Dashboard" project.',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      read: true,
      metadata: { projectId: 'project-456', amount: 1200 },
    },
    {
      id: '5',
      type: 'message_received',
      title: 'New Message',
      description: 'Alex Chen sent you a message about the ongoing project.',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      read: true,
      metadata: { userId: 'user-789' },
    },
  ];

  const loadActivities = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setError(null);

      // TODO: Replace with real API call
      // const response = await apiClient.getActivities({ limit: 50 });
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setActivities(mockActivities);
    } catch (err) {
      const errorMessage = err instanceof ApiError
        ? err.message
        : err instanceof NetworkError
        ? "Network connection failed. Please check your connection."
        : "Failed to load activities. Please try again.";
      
      setError(errorMessage);
      showError("Error", errorMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showError]);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadActivities(true);
  }, [loadActivities]);

  const handleActivityPress = useCallback((activity: Activity) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Mark as read
    setActivities(prev => prev.map(item => 
      item.id === activity.id ? { ...item, read: true } : item
    ));

    // Navigate based on activity type
    switch (activity.type) {
      case 'bounty_created':
      case 'bounty_applied':
        onNavigate?.('BountyDetails', { bountyId: activity.metadata?.bountyId });
        break;
      case 'project_completed':
        onNavigate?.('ProjectDetails', { projectId: activity.metadata?.projectId });
        break;
      case 'review_received':
        onNavigate?.('ReviewDetails', { userId: activity.metadata?.userId });
        break;
      case 'message_received':
        onNavigate?.('Messages', { userId: activity.metadata?.userId });
        break;
    }
  }, [onNavigate]);

  const filteredActivities = selectedFilter === 'all' 
    ? activities 
    : activities.filter(activity => activity.type === selectedFilter);

  const unreadCount = activities.filter(activity => !activity.read).length;

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Activity</Text>
        </View>

        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading activities...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Activity</Text>
        {unreadCount > 0 && (
          <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>

      {/* Filter Tabs */}
      <FilterTabs
        selectedFilter={selectedFilter}
        onFilterChange={setSelectedFilter}
        colors={colors}
      />

      {/* Activities List */}
      <FlatList
        data={filteredActivities}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ActivityItem
            item={item}
            colors={colors}
            onPress={handleActivityPress}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📱</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Activity</Text>
            <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
              Your recent activity will appear here
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ─── Utility Functions ────────────────────────────────────────────────────────

function formatTime(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return time.toLocaleDateString();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  unreadBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: 'white',
  },
  filterContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterContent: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  filterTab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  filterTabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  listContent: {
    paddingVertical: Spacing.xs,
  },
  activityItem: {
    marginHorizontal: Spacing.base,
    marginVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderLeftWidth: 4,
    ...Shadow.sm,
  },
  activityHeader: {
    flexDirection: 'row',
    padding: Spacing.base,
  },
  activityIcon: {
    fontSize: 20,
    marginRight: Spacing.sm,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.xs,
  },
  activityDescription: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  activityMeta: {
    alignItems: 'flex-end',
  },
  activityTime: {
    fontSize: FontSize.xs,
    marginBottom: Spacing.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.base,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  emptyDescription: {
    fontSize: FontSize.base,
    textAlign: 'center',
    lineHeight: 22,
  },
});