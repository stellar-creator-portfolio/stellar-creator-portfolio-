/**
 * tRPC Client Configuration for Frontend
 * 
 * Provides type-safe API calls with automatic error handling,
 * loading states, and optimistic updates.
 */

import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@/backend/src/router';

// ─── tRPC React Hooks ─────────────────────────────────────────────────────────

export const trpc = createTRPCReact<AppRouter>();

// ─── Client Configuration ─────────────────────────────────────────────────────

function getBaseUrl() {
  if (typeof window !== 'undefined') {
    // Browser should use relative url
    return '';
  }
  if (process.env.VERCEL_URL) {
    // SSR should use vercel url
    return `https://${process.env.VERCEL_URL}`;
  }
  // dev SSR should use localhost
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      // Add auth headers
      headers: async () => {
        const token = typeof window !== 'undefined' 
          ? localStorage.getItem('auth-token')
          : null;
        
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

// ─── Proxy Client for Server-Side Usage ──────────────────────────────────────

export const trpcProxy = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
    }),
  ],
});

// ─── Query Client with Optimized Defaults ────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.data?.httpStatus >= 400 && error?.data?.httpStatus < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

// ─── Utility Hooks ────────────────────────────────────────────────────────────

export function useTrpcErrorHandler() {
  return {
    onError: (error: any) => {
      console.error('tRPC Error:', error);
      // Could integrate with toast notifications here
      if (error?.data?.code === 'UNAUTHORIZED') {
        // Redirect to login
        window.location.href = '/login';
      }
    },
  };
}

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type { AppRouter };