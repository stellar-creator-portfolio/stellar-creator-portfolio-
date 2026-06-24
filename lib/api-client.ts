/**
 * Typed API client for the Stellar backend.
 *
 * Every request goes through `apiFetch`, which:
 *  - Attaches `Content-Type: application/json`
 *  - Parses the `ApiResponse<T>` envelope
 *  - Throws `ApiClientError` on network or API-level failures
 *
 * Usage:
 *   const creator = await apiFetch<Creator>('/api/creators/alex-studio');
 */

import {
  type ApiResponse,
  type ApiError,
  type ApiErrorCode,
  type Bounty,
  type Creator,
  type CreatorReputationPayload,
  type PaginatedData,
  type ReviewSubmission,
  type EscrowTransactionRequest,
  type EscrowTransactionResponse,
  isApiSuccess,
} from "./api-models";
import { notifyLoadingChange } from "../components/layout-provider";

// ── Error class ───────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: { field: string; message: string }[],
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  static fromApiError(error: ApiError, status?: number): ApiClientError {
    return new ApiClientError(
      error.code,
      error.message,
      error.fieldErrors,
      status,
    );
  }

  static network(
    message = "Network error — please check your connection",
  ): ApiClientError {
    return new ApiClientError("SERVICE_UNAVAILABLE", message);
  }
}

// ── Base fetch ────────────────────────────────────────────────────────────────

const BASE_URL =
  typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL ?? "") : "";

export const API_VERSION = "";
export const API_BASE = "/api";

/** localStorage key where the JWT is stored after a successful auth flow. */
const JWT_STORAGE_KEY = "stellar_auth_token";

/**
 * Persist a JWT so subsequent requests are automatically authenticated.
 * Call this after a successful /api/auth/verify response.
 */
export function setAuthToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(JWT_STORAGE_KEY, token);
  }
}

/** Remove the stored JWT (e.g. on logout). */
export function clearAuthToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(JWT_STORAGE_KEY);
  }
}

/** Read the current JWT from localStorage, or null if not present. */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(JWT_STORAGE_KEY);
}

/**
 * Fetch a backend endpoint and unwrap the `ApiResponse<T>` envelope.
 * Throws `ApiClientError` on any failure so callers never receive raw errors.
 *
 * JWT interceptor: if a token is stored via `setAuthToken`, it is automatically
 * attached as `Authorization: Bearer <token>` on every request.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;

  // JWT interceptor — attach token when available
  const token = getAuthToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeader,
    ...(init.headers ?? {}),
  };

  notifyLoadingChange(1);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    notifyLoadingChange(-1);
    throw ApiClientError.network();
  }

  let envelope: ApiResponse<T>;
  try {
    envelope = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      "INTERNAL_SERVER_ERROR",
      `Unexpected response format from ${path}`,
      undefined,
      res.status,
    );
  } finally {
    notifyLoadingChange(-1);
  }

  if (isApiSuccess(envelope)) return envelope.data;

  throw ApiClientError.fromApiError(envelope.error, res.status);
}

// ── Request deduplication (prevents duplicate in-flight requests) ────────────────
const requestCache = new Map<string, Promise<any>>();

function getCacheKey(path: string, init?: RequestInit): string {
  const method = init?.method || "GET";
  const body = init?.body ? JSON.stringify(init.body) : "";
  return `${method}:${path}:${body}`;
}

async function dedupedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getCacheKey(path, init);

  if (requestCache.has(key)) {
    return requestCache.get(key)!;
  }

  const promise = apiFetch<T>(path, init);
  requestCache.set(key, promise);

  try {
    return await promise;
  } finally {
    // Clear from cache after request completes
    requestCache.delete(key);
  }
}

// ── Domain helpers ────────────────────────────────────────────────────────────

/** GET /api/creators - optionally filter by discipline or search term. */
export async function fetchCreators(params?: {
  discipline?: string;
  search?: string;
}): Promise<{ creators: Creator[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.discipline) qs.set("discipline", params.discipline);
  if (params?.search) qs.set("search", params.search);
  const query = qs.toString() ? `?${qs}` : "";
  return dedupedFetch(`${API_BASE}/creators${query}`);
}

/** GET /api/creators/:id */
export async function fetchCreator(id: string): Promise<Creator> {
  return dedupedFetch(`${API_BASE}/creators/${id}`);
}

/** GET /api/creators/:id/reputation */
export async function fetchCreatorReputation(
  id: string,
): Promise<CreatorReputationPayload> {
  return dedupedFetch(`${API_BASE}/creators/${id}/reputation`);
}

/** POST /api/creators/reviews/batch — batch fetch reviews for multiple creators */
export async function fetchCreatorReviewsBatch(
  creatorIds: string[],
): Promise<Record<string, { reviews: any[]; total: number }>> {
  return apiFetch("/api/creators/reviews/batch", {
    method: "POST",
    body: JSON.stringify({ creatorIds }),
  });
}

/** POST /api/creators/reputation/batch — batch fetch reputation for multiple creators */
export async function fetchCreatorReputationBatch(
  creatorIds: string[],
): Promise<Record<string, any>> {
  return apiFetch("/api/creators/reputation/batch", {
    method: "POST",
    body: JSON.stringify({ creatorIds }),
  });
}

/** GET /api/creators/:id/reviews - Enhanced with filtering support */
export async function fetchCreatorReviews(
  id: string,
  filters?: {
    minRating?: number;
    maxRating?: number;
    dateFrom?: string;
    dateTo?: string;
    verifiedOnly?: boolean;
    sortBy?: "createdAt" | "rating" | "reviewerName";
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
  },
): Promise<{
  creatorId: string;
  aggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  reviews: {
    reviews: PublicReview[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  appliedFilters: any;
}> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value.toString());
      }
    });
  }
  const query = params.toString() ? `?${params}` : "";
  return apiFetch(`${API_BASE}/creators/${id}/reviews${query}`);
}

/** GET /api/reviews - List all reviews with filtering */
export async function fetchAllReviews(filters?: {
  minRating?: number;
  maxRating?: number;
  dateFrom?: string;
  dateTo?: string;
  verifiedOnly?: boolean;
  sortBy?: "createdAt" | "rating" | "reviewerName";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}): Promise<{
  reviews: {
    reviews: PublicReview[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  overallAggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  appliedFilters: any;
}> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value.toString());
      }
    });
  }
  const query = params.toString() ? `?${params}` : "";
  return apiFetch(`${API_BASE}/reviews${query}`);
}

/** GET /api/bounties - optionally paginated. */
export async function fetchBounties(params?: {
  page?: number;
  limit?: number;
  category?: string;
  difficulty?: string;
  status?: string;
}): Promise<PaginatedData<Bounty>> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.category) qs.set("category", params.category);
  if (params?.difficulty) qs.set("difficulty", params.difficulty);
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch(`${API_BASE}/bounties${query}`);
}

/** GET /api/bounties/:id */
export async function fetchBounty(id: string): Promise<Bounty> {
  return apiFetch(`${API_BASE}/bounties/${id}`);
}

/** GET /api/freelancers - optionally filter by discipline. */
export async function fetchFreelancers(params?: {
  discipline?: string;
}): Promise<{ freelancers: unknown[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.discipline) qs.set("discipline", params.discipline);
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch(`${API_BASE}/freelancers${query}`);
}

/** GET /api/freelancers/:address */
export async function fetchFreelancer(address: string): Promise<unknown> {
  return apiFetch(`${API_BASE}/freelancers/${address}`);
}

/** POST /api/reviews - submit a review after bounty completion. */
export async function submitReview(
  data: ReviewSubmission,
): Promise<{ reviewId: string }> {
  return apiFetch(`${API_BASE}/reviews`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** POST /api/escrow/transaction - submit a Stellar escrow transaction via the backend SDK. */
export async function submitEscrowTransaction(
  data: EscrowTransactionRequest,
): Promise<EscrowTransactionResponse> {
  return apiFetch(`${API_BASE}/escrow/transaction`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** POST /api/escrow/:id/release - release escrowed funds to payee. */
export async function releaseEscrow(
  escrowId: string,
  authorizerAddress: string,
): Promise<EscrowTransactionResponse> {
  return apiFetch(`${API_BASE}/escrow/${escrowId}/release`, {
    method: "POST",
    body: JSON.stringify({ authorizerAddress }),
  });
}

// ── Webhook types ─────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "payment_refunded"
  | "dispute_opened"
  | "dispute_resolved";

export interface WebhookPayload {
  event_type: WebhookEventType;
  escrow_id: string;
  amount: number;
  timestamp: string;
  provider_event_id: string;
}

export interface WebhookAck {
  received: boolean;
  escrow_id: string;
  action_taken: string;
}

/**
 * POST /api/webhooks/payment - forward an external payment event to the
 * backend webhook handler. Primarily used in server-side code or tests;
 * the real webhook endpoint is called directly by the payment provider.
 */
export async function forwardPaymentWebhook(
  payload: WebhookPayload,
  signature: string,
): Promise<WebhookAck> {
  return apiFetch(`${API_BASE}/webhooks/payment`, {
    method: "POST",
    headers: { "X-Webhook-Signature": signature },
    body: JSON.stringify(payload),
  });
}
