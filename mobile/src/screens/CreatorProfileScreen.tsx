/**
 * CreatorProfileScreen — Issue #542
 * "Construct explicit dynamic Creator Native Profile visualizations correctly"
 *
 * Features:
 *  - Dynamic hero section with cover image placeholder + avatar
 *  - Discipline badge, name, title, tagline
 *  - Availability indicator (available / limited / unavailable)
 *  - Stats row: projects, clients, experience
 *  - Skills chip list (horizontally scrollable)
 *  - Portfolio projects grid (2-column, lazy-rendered via FlatList)
 *  - Services list with pricing
 *  - Social links (LinkedIn, Twitter, Portfolio)
 *  - Contact / Message CTA
 *  - Full dark mode via useTheme()
 *  - Offline-first via useOfflineData
 *  - Pull-to-refresh
 *  - Zero frame drops: FlatList + useMemo sections
 *  - Accessibility labels throughout
 */

import React, {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { useOfflineData } from '../hooks/useOfflineData';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PROJECT_CARD_WIDTH = (SCREEN_WIDTH - Spacing.base * 2 - Spacing.sm) / 2;

// ─── Domain types ─────────────────────────────────────────────────────────────

interface Project {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  year: number;
}

interface Service {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  deliveryTime: number;
  rating: number;
  reviewCount: number;
}

interface CreatorProfile {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  tagline: string;
  linkedIn?: string;
  twitter?: string;
  portfolio?: string;
  skills: string[];
  projects: Project[];
  services?: Service[];
  stats?: { projects: number; clients: number; experience: number };
  hourlyRate?: number;
  responseTime?: string;
  availability?: 'available' | 'limited' | 'unavailable';
  rating?: number;
  reviewCount?: number;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CREATOR: CreatorProfile = {
  id: 'alex-studio',
  name: 'Alex Chen',
  title: 'Product Designer',
  discipline: 'UI/UX Design',
  bio: 'Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.',
  tagline: 'Design systems that scale',
  linkedIn: 'https://linkedin.com/in/alexchen',
  twitter: 'https://x.com/alexchen',
  portfolio: 'https://alexchen.design',
  skills: ['Figma', 'Design Systems', 'Prototyping', 'User Research', 'Accessibility', 'Design Thinking', 'Wireframing', 'Motion Design'],
  stats: { projects: 48, clients: 22, experience: 8 },
  hourlyRate: 120,
  responseTime: '2 hours',
  availability: 'available',
  rating: 4.9,
  reviewCount: 37,
  projects: [
    { id: 'p1', title: 'SaaSPro Design System', description: 'Comprehensive design system for enterprise SaaS', category: 'Design System', tags: ['Figma', 'Enterprise'], year: 2024 },
    { id: 'p2', title: 'FinTech Mobile App', description: 'Redesigned mobile banking app with improved UX', category: 'Product Design', tags: ['Mobile', 'Finance'], year: 2023 },
    { id: 'p3', title: 'E-commerce Redesign', description: 'Complete redesign — 40% conversion increase', category: 'E-commerce', tags: ['UX Research', 'Conversion'], year: 2023 },
    { id: 'p4', title: 'Healthcare Dashboard', description: 'Accessible analytics dashboard for clinicians', category: 'Healthcare', tags: ['Accessibility', 'Data Viz'], year: 2022 },
  ],
  services: [
    { id: 's1', name: 'Design System Audit', description: 'Full audit and improvement plan for your design system', basePrice: 1200, deliveryTime: 7, rating: 5.0, reviewCount: 12 },
    { id: 's2', name: 'UX Research Sprint', description: 'User interviews, synthesis, and actionable insights', basePrice: 2400, deliveryTime: 14, rating: 4.9, reviewCount: 8 },
    { id: 's3', name: 'Prototype & Handoff', description: 'High-fidelity prototype with developer-ready specs', basePrice: 800, deliveryTime: 5, rating: 4.8, reviewCount: 17 },
  ],
};

async function fetchCreatorProfile(creatorId: string): Promise<CreatorProfile> {
  await new Promise((r) => setTimeout(r, 500));
  return { ...MOCK_CREATOR, id: creatorId };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVAILABILITY_CONFIG = {
  available:   { label: 'Available now',       color: '#22c55e' },
  limited:     { label: 'Limited availability', color: '#f59e0b' },
  unavailable: { label: 'Unavailable',          color: '#ef4444' },
} as const;

function StarRating({ rating }: { rating: number }) {
  const { colors } = useTheme();
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: full  }).map((_, i) => <Text key={`f${i}`} style={{ color: colors.starFilled, fontSize: FontSize.sm }}>★</Text>)}
      {half && <Text style={{ color: colors.starFilled, fontSize: FontSize.sm }}>½</Text>}
      {Array.from({ length: empty }).map((_, i) => <Text key={`e${i}`} style={{ color: colors.starEmpty,  fontSize: FontSize.sm }}>★</Text>)}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const { colors } = useTheme();
  const CATEGORY_COLORS: Record<string, string> = {
    'Design System': '#6366f1',
    'Product Design': '#3b82f6',
    'E-commerce': '#f59e0b',
    'Healthcare': '#22c55e',
  };
  const accent = CATEGORY_COLORS[project.category] ?? '#6366f1';

  return (
    <View
      style={[
        projectStyles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, width: PROJECT_CARD_WIDTH },
      ]}
      accessible
      accessibilityLabel={`Project: ${project.title}, ${project.year}`}
    >
      {/* Colour-coded category banner */}
      <View style={[projectStyles.banner, { backgroundColor: accent + '22' }]}>
        <Text style={[projectStyles.bannerText, { color: accent }]} numberOfLines={1}>
          {project.category}
        </Text>
      </View>
      <View style={projectStyles.body}>
        <Text style={[projectStyles.title, { color: colors.text }]} numberOfLines={2}>
          {project.title}
        </Text>
        <Text style={[projectStyles.desc, { color: colors.textSecondary }]} numberOfLines={2}>
          {project.description}
        </Text>
        <View style={projectStyles.tags}>
          {project.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={[projectStyles.tag, { backgroundColor: colors.surfaceElevated }]}>
              <Text style={[projectStyles.tagText, { color: colors.textTertiary }]}>{tag}</Text>
            </View>
          ))}
        </View>
        <Text style={[projectStyles.year, { color: colors.textTertiary }]}>{project.year}</Text>
      </View>
    </View>
  );
}

const projectStyles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden', ...Shadow.sm },
  banner: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  bannerText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  body: { padding: Spacing.sm, gap: Spacing.xs },
  title: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, lineHeight: 18 },
  desc: { fontSize: FontSize.xs, lineHeight: 16 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  tagText: { fontSize: 10 },
  year: { fontSize: 10, marginTop: 2 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export interface CreatorProfileScreenProps {
  creatorId?: string;
  onBack?: () => void;
  onMessage?: (creatorId: string) => void;
}

export function CreatorProfileScreen({
  creatorId = 'alex-studio',
  onBack,
  onMessage,
}: CreatorProfileScreenProps) {
  const { colors, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback(() => fetchCreatorProfile(creatorId), [creatorId]);

  const { data: creator, isLoading, isStale, cachedAt, refetch } = useOfflineData<CreatorProfile>(
    `creator-profile-${creatorId}`,
    fetcher,
    { ttlMs: 10 * 60 * 1000 },
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleLink = useCallback(async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const supported = await Linking.canOpenURL(url);
    if (supported) Linking.openURL(url);
  }, []);

  const handleMessage = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onMessage?.(creatorId);
  }, [creatorId, onMessage]);

  // ── Memoised sections ───────────────────────────────────────────────────────

  const HeroSection = useMemo(() => {
    if (!creator) return null;
    const avail = creator.availability ? AVAILABILITY_CONFIG[creator.availability] : null;

    return (
      <View>
        {/* Cover gradient */}
        <View style={[heroStyles.cover, { backgroundColor: colors.primary + '33' }]}>
          <View style={[heroStyles.coverGradient, { backgroundColor: colors.accent + '22' }]} />
        </View>

        {/* Avatar */}
        <View style={heroStyles.avatarWrap}>
          <View style={[heroStyles.avatar, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Text style={heroStyles.avatarInitial}>
              {creator.name.charAt(0)}
            </Text>
          </View>
          {avail && (
            <View style={[heroStyles.availDot, { backgroundColor: avail.color, borderColor: colors.background }]} />
          )}
        </View>

        {/* Identity */}
        <View style={heroStyles.identity}>
          <View style={[heroStyles.disciplineBadge, { backgroundColor: colors.accent + '22' }]}>
            <Text style={[heroStyles.disciplineText, { color: colors.accent }]}>{creator.discipline}</Text>
          </View>
          <Text style={[heroStyles.name, { color: colors.text }]}>{creator.name}</Text>
          <Text style={[heroStyles.title, { color: colors.textSecondary }]}>{creator.title}</Text>
          <Text style={[heroStyles.tagline, { color: colors.textTertiary }]}>"{creator.tagline}"</Text>

          {/* Rating */}
          {creator.rating != null && (
            <View style={heroStyles.ratingRow}>
              <StarRating rating={creator.rating} />
              <Text style={[heroStyles.ratingText, { color: colors.textSecondary }]}>
                {creator.rating.toFixed(1)} ({creator.reviewCount} reviews)
              </Text>
            </View>
          )}

          {/* Availability */}
          {avail && (
            <View style={[heroStyles.availBadge, { backgroundColor: avail.color + '22' }]}>
              <View style={[heroStyles.availDotInline, { backgroundColor: avail.color }]} />
              <Text style={[heroStyles.availText, { color: avail.color }]}>{avail.label}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [creator, colors]);

  const StatsSection = useMemo(() => {
    if (!creator?.stats) return null;
    const items = [
      { label: 'Projects', value: String(creator.stats.projects) },
      { label: 'Clients',  value: String(creator.stats.clients)  },
      { label: 'Years',    value: String(creator.stats.experience) },
      ...(creator.hourlyRate ? [{ label: 'Rate', value: `$${creator.hourlyRate}/h` }] : []),
    ];
    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={statsStyles.row}>
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <View style={[statsStyles.divider, { backgroundColor: colors.border }]} />}
              <View style={statsStyles.cell} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
                <Text style={[statsStyles.value, { color: colors.primary }]}>{item.value}</Text>
                <Text style={[statsStyles.label, { color: colors.textTertiary }]}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>
    );
  }, [creator, colors]);

  const BioSection = useMemo(() => {
    if (!creator) return null;
    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[sectionStyles.heading, { color: colors.text }]}>About</Text>
        <Text style={[sectionStyles.body, { color: colors.textSecondary }]}>{creator.bio}</Text>
        {creator.responseTime && (
          <View style={bioStyles.responseRow}>
            <Text style={bioStyles.responseIcon}>⚡</Text>
            <Text style={[bioStyles.responseText, { color: colors.textSecondary }]}>
              Typically responds in {creator.responseTime}
            </Text>
          </View>
        )}
      </View>
    );
  }, [creator, colors]);

  const SkillsSection = useMemo(() => {
    if (!creator?.skills.length) return null;
    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[sectionStyles.heading, { color: colors.text }]}>Skills</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={skillStyles.scroll}>
          <View style={skillStyles.chips}>
            {creator.skills.map((skill) => (
              <View key={skill} style={[skillStyles.chip, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                <Text style={[skillStyles.chipText, { color: colors.primary }]}>{skill}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }, [creator, colors]);

  const ServicesSection = useMemo(() => {
    if (!creator?.services?.length) return null;
    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[sectionStyles.heading, { color: colors.text }]}>Services</Text>
        {creator.services.map((svc, i) => (
          <View
            key={svc.id}
            style={[
              serviceStyles.row,
              i < (creator.services?.length ?? 0) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
          >
            <View style={serviceStyles.info}>
              <Text style={[serviceStyles.name, { color: colors.text }]}>{svc.name}</Text>
              <Text style={[serviceStyles.desc, { color: colors.textSecondary }]} numberOfLines={2}>{svc.description}</Text>
              <View style={serviceStyles.meta}>
                <Text style={[serviceStyles.metaText, { color: colors.textTertiary }]}>⏱ {svc.deliveryTime}d</Text>
                <Text style={[serviceStyles.metaText, { color: colors.textTertiary }]}>★ {svc.rating.toFixed(1)} ({svc.reviewCount})</Text>
              </View>
            </View>
            <View style={serviceStyles.priceWrap}>
              <Text style={[serviceStyles.price, { color: colors.primary }]}>${svc.basePrice}</Text>
              <Text style={[serviceStyles.priceLabel, { color: colors.textTertiary }]}>starting</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }, [creator, colors]);

  const SocialSection = useMemo(() => {
    if (!creator) return null;
    const links = [
      creator.linkedIn  && { key: 'linkedin',  icon: '🔗', label: 'LinkedIn',  url: creator.linkedIn  },
      creator.twitter   && { key: 'twitter',   icon: '🐦', label: 'Twitter',   url: creator.twitter   },
      creator.portfolio && { key: 'portfolio', icon: '🌐', label: 'Portfolio', url: creator.portfolio },
    ].filter(Boolean) as { key: string; icon: string; label: string; url: string }[];

    if (!links.length) return null;

    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[sectionStyles.heading, { color: colors.text }]}>Links</Text>
        <View style={socialStyles.row}>
          {links.map((link) => (
            <Pressable
              key={link.key}
              onPress={() => handleLink(link.url)}
              style={[socialStyles.btn, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
              accessibilityRole="link"
              accessibilityLabel={`Open ${link.label}`}
            >
              <Text style={socialStyles.icon}>{link.icon}</Text>
              <Text style={[socialStyles.label, { color: colors.textSecondary }]}>{link.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }, [creator, colors, handleLink]);

  // ── Projects FlatList ───────────────────────────────────────────────────────

  const renderProject = useCallback(
    ({ item }: { item: Project }) => <ProjectCard project={item} />,
    [],
  );

  const ProjectsSection = useMemo(() => {
    if (!creator?.projects.length) return null;
    return (
      <View style={[sectionStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[sectionStyles.heading, { color: colors.text }]}>Portfolio</Text>
        <FlatList
          data={creator.projects}
          renderItem={renderProject}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: Spacing.sm }}
          contentContainerStyle={{ gap: Spacing.sm }}
          scrollEnabled={false}
          removeClippedSubviews
          accessibilityLabel="Portfolio projects"
        />
      </View>
    );
  }, [creator, colors, renderProject]);

  // ── CTA ─────────────────────────────────────────────────────────────────────

  const CTASection = useMemo(() => {
    if (!creator) return null;
    return (
      <View style={ctaStyles.wrap}>
        <Pressable
          style={[ctaStyles.btn, { backgroundColor: colors.primary }]}
          onPress={handleMessage}
          accessibilityRole="button"
          accessibilityLabel={`Message ${creator.name}`}
        >
          <Text style={ctaStyles.btnText}>💬 Message {creator.name.split(' ')[0]}</Text>
        </Pressable>
      </View>
    );
  }, [creator, colors, handleMessage]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Nav bar */}
      <View style={[styles.navbar, { borderBottomColor: colors.border }]}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
          </Pressable>
        )}
        <Text style={[styles.navTitle, { color: colors.text }]}>Creator Profile</Text>
        {isStale && cachedAt && (
          <Text style={[styles.staleNote, { color: colors.warning }]}>⚠️ Cached</Text>
        )}
      </View>

      {isLoading && !creator ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading profile…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {HeroSection}
          {StatsSection}
          {BioSection}
          {SkillsSection}
          {ServicesSection}
          {ProjectsSection}
          {SocialSection}
          {CTASection}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { marginRight: Spacing.sm, padding: Spacing.xs },
  backIcon: { fontSize: 24, fontWeight: FontWeight.bold },
  navTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  staleNote: { fontSize: FontSize.xs },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: FontSize.base },
  content: { paddingBottom: Spacing['4xl'] },
});

const heroStyles = StyleSheet.create({
  cover: { height: 140, position: 'relative', overflow: 'hidden' },
  coverGradient: { position: 'absolute', top: 0, right: 0, width: 200, height: 200, borderRadius: 100 },
  avatarWrap: { position: 'absolute', top: 100, left: Spacing.base },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3,
  },
  avatarInitial: { fontSize: FontSize['3xl'], fontWeight: FontWeight.bold, color: '#fff' },
  availDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 16, height: 16, borderRadius: 8, borderWidth: 2,
  },
  identity: { paddingTop: 52, paddingHorizontal: Spacing.base, paddingBottom: Spacing.base, gap: Spacing.xs },
  disciplineBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  disciplineText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  name: { fontSize: FontSize['3xl'], fontWeight: FontWeight.extrabold },
  title: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  tagline: { fontSize: FontSize.sm, fontStyle: 'italic' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  ratingText: { fontSize: FontSize.sm },
  availBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full, gap: 5, marginTop: 2 },
  availDotInline: { width: 7, height: 7, borderRadius: 4 },
  availText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
});

const sectionStyles = StyleSheet.create({
  card: { marginHorizontal: Spacing.base, marginTop: Spacing.md, borderRadius: Radius.xl, borderWidth: 1, padding: Spacing.base, ...Shadow.sm },
  heading: { fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  body: { fontSize: FontSize.base, lineHeight: 22 },
});

const statsStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: Spacing.xs },
  divider: { width: StyleSheet.hairlineWidth, height: 36 },
  value: { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold },
  label: { fontSize: FontSize.xs, marginTop: 2 },
});

const bioStyles = StyleSheet.create({
  responseRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm, gap: Spacing.xs },
  responseIcon: { fontSize: FontSize.sm },
  responseText: { fontSize: FontSize.sm },
});

const skillStyles = StyleSheet.create({
  scroll: { marginTop: Spacing.xs },
  chips: { flexDirection: 'row', gap: Spacing.xs, paddingBottom: Spacing.xs },
  chip: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.full, borderWidth: 1 },
  chipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});

const serviceStyles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: Spacing.sm, gap: Spacing.sm },
  info: { flex: 1, gap: 3 },
  name: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  desc: { fontSize: FontSize.xs, lineHeight: 16 },
  meta: { flexDirection: 'row', gap: Spacing.sm, marginTop: 2 },
  metaText: { fontSize: FontSize.xs },
  priceWrap: { alignItems: 'flex-end', justifyContent: 'center' },
  price: { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  priceLabel: { fontSize: FontSize.xs },
});

const socialStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1, gap: Spacing.xs },
  icon: { fontSize: FontSize.base },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});

const ctaStyles = StyleSheet.create({
  wrap: { marginHorizontal: Spacing.base, marginTop: Spacing.lg },
  btn: { paddingVertical: Spacing.base, borderRadius: Radius.xl, alignItems: 'center', ...Shadow.md },
  btnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: '#fff' },
});
