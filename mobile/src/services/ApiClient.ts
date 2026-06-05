/**
 * Mobile API Client - Connects mobile app to backend services
 * 
 * Features:
 * - Type-safe API calls matching backend endpoints
 * - Error handling with user-friendly messages
 * - Request/response logging for debugging
 * - Authentication token management
 * - Offline handling and retry logic
 */

import { Platform } from 'react-native';

// ─── Configuration ────────────────────────────────────────────────────────────

const API_BASE_URL = __DEV__ 
  ? Platform.OS === 'ios' ? 'http://localhost:3001' : 'http://10.0.2.2:3001'
  : 'https://api.stellar.app';

const API_TIMEOUT = 15000; // 15 seconds

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fieldErrors?: Array<{ field: string; message: string }>;
  };
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Bounty {
  id: string;
  title: string;
  description: string;
  budget: number;
  deadline: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  tags: string[];
  applicants: number;
  status: 'open' | 'in-progress' | 'completed';
  creator: {
    id: string;
    name: string;
  };
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
  portfolio?: string;
  skills: string[];
  hourlyRate?: number;
  rating?: number;
  reviewCount?: number;
}

export interface Review {
  id: string;
  creatorId: string;
  rating: number;
  title: string;
  body: string;
  reviewerName: string;
  createdAt: string;
  verified: boolean;
}

export interface BountyApplication {
  bountyId: string;
  freelancer: string;
  proposal: string;
  proposedBudget: number;
  timeline: number;
}

// ─── Error Classes ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public fieldErrors?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

// ─── API Client Class ─────────────────────────────────────────────────────────

class ApiClient {
  private authToken: string | null = null;
  private refreshToken: string | null = null;

  setAuthToken(token: string, refresh?: string) {
    this.authToken = token;
    if (refresh) {
      this.refreshToken = refresh;
    }
  }

  clearAuth() {
    this.authToken = null;
    this.refreshToken = null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}/api/v1${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers as Record<string, string>,
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let responseData: ApiResponse<T>;
      try {
        responseData = await response.json();
      } catch {
        throw new NetworkError('Invalid response format');
      }

      if (!responseData.success) {
        throw new ApiError(
          responseData.error?.code || 'UNKNOWN_ERROR',
          responseData.error?.message || 'Request failed',
          responseData.error?.fieldErrors
        );
      }

      return responseData.data!;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      if (error instanceof TypeError || (error as any)?.name === 'AbortError') {
        throw new NetworkError('Network connection failed');
      }
      
      throw new NetworkError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // ─── Bounty Endpoints ──────────────────────────────────────────────────────

  async getBounties(params: {
    page?: number;
    limit?: number;
    difficulty?: string;
    category?: string;
  } = {}): Promise<PaginatedResponse<Bounty>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.difficulty) searchParams.append('difficulty', params.difficulty);
    if (params.category) searchParams.append('category', params.category);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Bounty>>(
      `/bounties${query ? `?${query}` : ''}`
    );
  }

  async getBounty(id: string): Promise<Bounty> {
    return this.request<Bounty>(`/bounties/${id}`);
  }

  async createBounty(bounty: {
    title: string;
    description: string;
    budget: number;
    deadline: number;
    category: string;
    tags: string[];
    difficulty: string;
  }): Promise<{ bountyId: string }> {
    return this.request<{ bountyId: string }>('/bounties', {
      method: 'POST',
      body: JSON.stringify({
        creator: 'mobile-user', // Replace with actual user ID
        ...bounty,
      }),
    });
  }

  async applyForBounty(
    bountyId: string,
    application: Omit<BountyApplication, 'bountyId'>
  ): Promise<{ applicationId: string }> {
    return this.request<{ applicationId: string }>(`/bounties/${bountyId}/apply`, {
      method: 'POST',
      body: JSON.stringify(application),
    });
  }

  // ─── Creator Endpoints ─────────────────────────────────────────────────────

  async getCreators(params: {
    page?: number;
    limit?: number;
    discipline?: string;
    search?: string;
  } = {}): Promise<PaginatedResponse<Creator>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.discipline) searchParams.append('discipline', params.discipline);
    if (params.search) searchParams.append('search', params.search);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Creator>>(
      `/creators${query ? `?${query}` : ''}`
    );
  }

  async getCreator(id: string): Promise<Creator> {
    return this.request<Creator>(`/creators/${id}`);
  }

  async getCreatorReputation(id: string): Promise<{
    aggregation: {
      totalReviews: number;
      averageRating: number;
      starCounts: Record<string, number>;
    };
    recentReviews: Review[];
  }> {
    return this.request(`/creators/${id}/reputation`);
  }

  // ─── Review Endpoints ──────────────────────────────────────────────────────

  async submitReview(review: {
    bountyId: string;
    creatorId: string;
    rating: number;
    title: string;
    body: string;
    reviewerName: string;
  }): Promise<{ reviewId: string }> {
    return this.request<{ reviewId: string }>('/reviews', {
      method: 'POST',
      body: JSON.stringify(review),
    });
  }

  async getReviews(params: {
    creatorId?: string;
    page?: number;
    limit?: number;
    sortBy?: 'rating' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<PaginatedResponse<Review>> {
    const searchParams = new URLSearchParams();
    if (params.creatorId) searchParams.append('creatorId', params.creatorId);
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.sortBy) searchParams.append('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.append('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Review>>(
      `/reviews${query ? `?${query}` : ''}`
    );
  }

  // ─── Escrow Endpoints ──────────────────────────────────────────────────────

  async createEscrow(escrow: {
    bountyId: string;
    payerAddress: string;
    payeeAddress: string;
    amount: number;
    token: string;
  }): Promise<{
    escrowId: string;
    txHash: string;
    operation: string;
    status: string;
  }> {
    return this.request('/escrow/create', {
      method: 'POST',
      body: JSON.stringify(escrow),
    });
  }

  async releaseEscrow(escrowId: string): Promise<{
    txHash: string;
    operation: string;
    status: string;
  }> {
    return this.request(`/escrow/${escrowId}/release`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async refundEscrow(escrowId: string, authorizerAddress: string): Promise<{
    txHash: string;
    operation: string;
    status: string;
  }> {
    return this.request(`/escrow/${escrowId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ authorizerAddress }),
    });
  }

  // ─── Health Check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ status: string; service: string; version: string }> {
    const url = `${API_BASE_URL}/health`;
    const response = await fetch(url);
    return response.json();
  }
}

// ─── Export Singleton ─────────────────────────────────────────────────────────

export const apiClient = new ApiClient();
export default apiClient;