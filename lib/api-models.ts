/**
 * Domain models for API responses.
 *
 * Provides consistent data formatting and error handling for all
 * communication between the frontend and the Stellar backend API.
 * The shape mirrors the Rust `ApiResponse<T>` struct in
 * `backend/services/api/src/main.rs`.
 */

// ── Core envelope ────────────────────────────────────────────────────────────

/** Successful API response envelope. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  error: null;
}

/** Failed API response envelope. */
export interface ApiFailure {
  success: false;
  data: null;
  error: ApiError;
  message?: string;
}

/** Discriminated union covering every API response shape. */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ── Error models ─────────────────────────────────────────────────────────────

/** Structured error returned by the API. */
export interface ApiError {
  /** Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR"). */
  code: ApiErrorCode;
  /** Human-readable description of the error. */
  message: string;
  /** Per-field validation errors, present when code === "VALIDATION_ERROR". */
  fieldErrors?: FieldError[];
}

/** Per-field validation error detail. */
export interface FieldError {
  field: string;
  message: string;
}

/** Exhaustive set of error codes the API may return. */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE';

// ── Pagination ────────────────────────────────────────────────────────────────

/** Pagination metadata included in list responses. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Paginated list response data. */
export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

// ── Helper constructors ───────────────────────────────────────────────────────

/** Build a successful response envelope. */
export function apiSuccess<T>(data: T, message?: string): ApiSuccess<T> {
  return { success: true, data, error: null, ...(message ? { message } : {}) };
}

/** Build a failed response envelope. */
export function apiFailure(
  code: ApiErrorCode,
  message: string,
  fieldErrors?: FieldError[],
): ApiFailure {
  const error: ApiError = { code, message, ...(fieldErrors ? { fieldErrors } : {}) };
  return { success: false, data: null, error };
}

/** Build a paginated data payload. */
export function paginatedData<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedData<T> {
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ── Type guards ───────────────────────────────────────────────────────────────

/** Narrow an `ApiResponse<T>` to `ApiSuccess<T>`. */
export function isApiSuccess<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return res.success === true;
}

/** Narrow an `ApiResponse<T>` to `ApiFailure`. */
export function isApiFailure<T>(res: ApiResponse<T>): res is ApiFailure {
  return res.success === false;
}

/** Return true when the failure carries per-field validation errors. */
export function isValidationError(error: ApiError): boolean {
  return error.code === 'VALIDATION_ERROR' && Array.isArray(error.fieldErrors);
}

// ── Creator reputation (GET /api/creators/:id/reputation) ───────────────────

/** Single public review on a creator profile. */
export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  reviewerName: string;
  createdAt: string;
}

/** Histogram and average for a creator’s reviews. */
export interface ReputationAggregation {
  averageRating: number;
  totalReviews: number;
  stars5: number;
  stars4: number;
  stars3: number;
  stars2: number;
  stars1: number;
  isVerified: boolean;
  reliabilityScore: number;
}

/** Payload for creator reputation + recent reviews. */
export interface CreatorReputationPayload {
  creatorId: string;
  aggregation: ReputationAggregation;
  recentReviews: PublicReview[];
}

/** Paginated reviews response */
export interface PaginatedReviews {
  reviews: PublicReview[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Review filter options */
export interface ReviewFilterOptions {
  minRating?: number;
  maxRating?: number;
  dateFrom?: string;
  dateTo?: string;
  verifiedOnly?: boolean;
  sortBy?: 'createdAt' | 'rating' | 'reviewerName';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Enhanced creator reputation payload with filtering support */
export interface FilteredCreatorReputationPayload {
  creatorId: string;
  aggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  reviews: PaginatedReviews;
  appliedFilters: ReviewFilterOptions;
}

// ── Review submission ─────────────────────────────────────────────────────────────

/** Payload sent when submitting a review after bounty completion. */
export interface ReviewSubmission {
  bountyId: string;
  creatorId: string;
  rating: number;       // 1–5
  title: string;
  body: string;
  reviewerName: string;
}

/** Validated review submission — all fields confirmed non-empty. */
export type ValidatedReview = ReviewSubmission;

/** Validate a ReviewSubmission. Returns field errors or null if valid. */
export function validateReview(data: Partial<ReviewSubmission>): FieldError[] | null {
  const errors: FieldError[] = [];
  if (!data.bountyId?.trim()) errors.push({ field: 'bountyId', message: 'Bounty ID is required' });
  if (!data.creatorId?.trim()) errors.push({ field: 'creatorId', message: 'Creator ID is required' });
  if (!data.rating || data.rating < 1 || data.rating > 5)
    errors.push({ field: 'rating', message: 'Rating must be between 1 and 5' });
  if (!data.title?.trim()) errors.push({ field: 'title', message: 'Title is required' });
  if (!data.body?.trim()) errors.push({ field: 'body', message: 'Feedback is required' });
  if (!data.reviewerName?.trim()) errors.push({ field: 'reviewerName', message: 'Your name is required' });
  return errors.length > 0 ? errors : null;
}

// ── Escrow / Transaction models ───────────────────────────────────────────────

/** Supported escrow operations submitted via the Stellar SDK. */
export type EscrowOperation = 'deposit' | 'release' | 'refund' | 'dispute';

/** Payload for submitting an escrow transaction. */
export interface EscrowTransactionRequest {
  bountyId: string;
  escrowId?: string;
  operation: EscrowOperation;
  amount?: number;
  payerAddress: string;
  payeeAddress?: string;
  tokenAddress?: string;
  timelock?: number;
}

/** Response returned after a successful escrow transaction submission. */
export interface EscrowTransactionResponse {
  escrowId: string;
  txHash: string;
  operation: EscrowOperation;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: string;
}

/** Validate an EscrowTransactionRequest. Returns field errors or null if valid. */
export function validateEscrowTransaction(
  data: Partial<EscrowTransactionRequest>,
): FieldError[] | null {
  const errors: FieldError[] = [];
  if (!data.bountyId?.trim()) errors.push({ field: 'bountyId', message: 'Bounty ID is required' });
  if (!data.operation) errors.push({ field: 'operation', message: 'Operation is required' });
  if (!data.payerAddress?.trim()) errors.push({ field: 'payerAddress', message: 'Payer address is required' });
  if (data.operation === 'deposit') {
    if (!data.payeeAddress?.trim()) errors.push({ field: 'payeeAddress', message: 'Payee address is required for deposit' });
    if (!data.amount || data.amount <= 0) errors.push({ field: 'amount', message: 'Amount must be positive' });
    if (!data.tokenAddress?.trim()) errors.push({ field: 'tokenAddress', message: 'Token address is required for deposit' });
  }
  return errors.length > 0 ? errors : null;
}

// ── Bounty (mirrors Rust Bounty struct) ──────────────────────────────────────

export type BountyStatus = 'open' | 'in-progress' | 'completed' | 'disputed' | 'cancelled';
export type BountyDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface Bounty {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: string; // ISO date string from API
  difficulty: BountyDifficulty;
  category: string;
  tags: string[];
  applicants: number;
  status: BountyStatus;
  requiredSkills: string[];
  deliverables: string;
  creatorAddress?: string;
  escrowId?: string;
}

// ── Anchor reliability (GET /api/anchors/scores) ──────────────────────────

/** Computed reliability score for a single anchor. */
export interface AnchorReliabilityScore {
  /** Anchor identifier (e.g. "circle-usdc", "bitso-mxn"). */
  anchorId: string;
  /** Reliability score in [0.0, 1.0]. 1.0 = perfect, 0.0 = all failures. */
  score: number;
  /** Total number of events that contributed to this score. */
  eventCount: number;
  /** Sum of decay weights across all events (effective sample size). */
  effectiveWeight: number;
  /**
   * Statistical confidence in the score, derived from the Wilson score
   * interval for a weighted proportion (95% CI).
   *
   * Range [0.0, 1.0]:
   * - 1.0 – high certainty (many recent events, score near 0 or 1).
   * - 0.0 – no information (zero effective weight).
   *
   * Computed as `1 − 1.96 * sqrt(score * (1 − score) / effectiveWeight)`.
   */
  confidence: number;
}

export interface Creator {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  avatar: string;
  coverImage: string;
  tagline: string;
  linkedIn: string;
  twitter: string;
  portfolio?: string;
  skills: string[];
  stats?: { projects: number; clients: number; experience: number };
  hourlyRate?: number;
  responseTime?: string;
  availability?: 'available' | 'limited' | 'unavailable';
  rating?: number;
  reviewCount?: number;
}
