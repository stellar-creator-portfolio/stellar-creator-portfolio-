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
  PortfolioUpload: undefined;
  // Issue #542 — Creator Native Profile
  CreatorProfile: { creatorId: string };
  // Issue #544 — Freelancer Directory
  FreelancerDirectory: undefined;
  FreelancerProfile: { creatorId: string };
  // Issue #545 — Image Picker
  ImagePicker: { maxImages?: number };
  // Issue #543 — Deep-Linking (Messaging already existed)
  Messaging: { conversationId: string; recipientName?: string };
  DetailsView: { itemId?: string };
  BiometricAuth: undefined;
  // Infinite scroll screens
  BountyList: undefined;
  CreatorDirectory: undefined;
  // Auth gateway
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Activity: undefined;
  Dashboard: undefined;
  Profile: undefined;
  Settings: undefined;
};

// ─── File Upload ──────────────────────────────────────────────────────────────

export type UploadStatus =
  | 'idle'
  | 'pending'
  | 'uploading'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadFile {
  /** Unique local ID */
  id: string;
  /** Display name */
  name: string;
  /** Local URI on device */
  uri: string;
  /** MIME type e.g. image/jpeg */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** 0-100 */
  progress: number;
  status: UploadStatus;
  /** Remote URL after successful upload */
  remoteUrl?: string;
  /** Error message if status === 'error' */
  error?: string;
  /** Seconds elapsed for the upload */
  elapsedSec?: number;
  /** Upload start timestamp */
  startedAt?: number;
}

export interface BucketUploadConfig {
  /**
   * Endpoint that returns a presigned URL for the given filename+mimeType.
   * GET /api/upload/presign?filename=foo.jpg&mimeType=image%2Fjpeg
   * Response: { url: string; publicUrl: string }
   */
  presignEndpoint: string;
  /** Extra headers to send to YOUR server (auth tokens, etc.) */
  authHeaders?: Record<string, string>;
  /** Max concurrent uploads. Default 2. */
  concurrency?: number;
  /** Max retries per file. Default 3. */
  maxRetries?: number;
  /** Chunk size in bytes for multipart. Default 5 MB. */
  chunkSize?: number;
}

export interface PresignResponse {
  /** Presigned PUT URL pointing directly at the bucket */
  url: string;
  /** Public read URL of the uploaded file */
  publicUrl: string;
}
