/**
 * Shared domain types for the Stellar mobile app.
 */

// ─── Network / Offline ────────────────────────────────────────────────────────

export type NetworkState = "online" | "offline" | "unknown";

export type SyncStatus = "synced" | "pending" | "syncing" | "error";

export interface QueuedOperation {
  id: string;
  type: "create" | "update" | "delete";
  endpoint: string;
  payload: unknown;
  retries: number;
  createdAt: string;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  placeholder: string;
}

// ─── Analytics / Dashboard ────────────────────────────────────────────────────

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";

export interface MetricCard {
  id: string;
  label: string;
  value: number;
  previousValue: number;
  unit: string;
  trend: "up" | "down" | "flat";
  trendPct: number;
}

export interface ChartDataPoint {
  label: string; // x-axis label (date, week, etc.)
  value: number;
  secondaryValue?: number;
}

export interface DashboardData {
  period: AnalyticsPeriod;
  metrics: MetricCard[];
  earningsChart: ChartDataPoint[];
  bountiesChart: ChartDataPoint[];
  topSkills: Array<{ skill: string; count: number }>;
  recentActivity: Array<{
    id: string;
    label: string;
    time: string;
    type: string;
  }>;
}

export interface PortfolioSummary {
  id: string;
  title: string;
  subtitle: string;
  creator: string;
  value: string;
  followers: number;
  change: number;
  tags: string[];
}

export type ProjectBountyKind = "project" | "bounty";
export type ProjectBountyStatus = "Live" | "Closing" | "Awarded";

export interface ProjectBountyItem {
  id: string;
  kind: ProjectBountyKind;
  title: string;
  subtitle: string;
  reward: string;
  due: string;
  status: ProjectBountyStatus;
  tags: string[];
}

export interface HomeData {
  trendingPortfolios: PortfolioSummary[];
  quickMetrics: MetricCard[];
  projectBountyItems: ProjectBountyItem[];
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  MainTabs: undefined;
  Dashboard: { period?: AnalyticsPeriod };
  LanguageSettings: undefined;
  BiometricAuth: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Activity: undefined;
  Dashboard: undefined;
  Profile: undefined;
  Settings: undefined;
};
