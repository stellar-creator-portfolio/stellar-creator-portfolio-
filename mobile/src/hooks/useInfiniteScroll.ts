/**
 * useInfiniteScroll — Memory-optimized infinite scrolling hook
 * 
 * Features:
 *  - Efficient pagination state management
 *  - Automatic cache invalidation
 *  - Memory cleanup on unmount
 *  - Deduplication of requests
 *  - Configurable page size and memory limits
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface InfiniteScrollConfig {
  pageSize: number;
  maxItems?: number; // Maximum items to keep in memory (0 = unlimited)
  initialData?: any[];
  onLoadMore?: (page: number, pageSize: number) => Promise<any[]>;
  onError?: (error: Error) => void;
}

export interface InfiniteScrollState {
  data: any[];
  isLoading: boolean;
  isFetching: boolean;
  hasMore: boolean;
  error: Error | null;
  page: number;
}

interface PendingRequest {
  page: number;
  promise: Promise<any[]>;
}

export const useInfiniteScroll = (config: InfiniteScrollConfig) => {
  const {
    pageSize = 20,
    maxItems = 500,
    initialData = [],
    onLoadMore,
    onError,
  } = config;

  const [state, setState] = useState<InfiniteScrollState>({
    data: initialData,
    isLoading: initialData.length === 0,
    isFetching: false,
    hasMore: true,
    error: null,
    page: 1,
  });

  const pendingRequestRef = useRef<PendingRequest | null>(null);
  const loadedPagesRef = useRef<Set<number>>(new Set([initialData.length > 0 ? 1 : 0]));
  const isMountedRef = useRef(true);

  /**
   * Cleanup and memory optimization
   */
  const pruneData = useCallback((items: any[], maxKeep: number) => {
    if (maxKeep === 0 || items.length <= maxKeep) {
      return items;
    }
    // Keep the most recent items
    return items.slice(-maxKeep);
  }, []);

  /**
   * Load next page with deduplication
   */
  const loadMore = useCallback(async () => {
    // Prevent loading while already loading
    if (state.isFetching || state.isLoading) {
      return;
    }

    // Prevent loading if no more data
    if (!state.hasMore) {
      return;
    }

    const nextPage = state.page + 1;

    // Check if page already loaded (deduplication)
    if (loadedPagesRef.current.has(nextPage)) {
      return;
    }

    // Check for pending request
    if (pendingRequestRef.current?.page === nextPage) {
      try {
        const newItems = await pendingRequestRef.current.promise;
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            data: pruneData([...prev.data, ...newItems], maxItems),
            page: nextPage,
            isFetching: false,
          }));
          loadedPagesRef.current.add(nextPage);
        }
      } catch (error) {
        if (isMountedRef.current) {
          const err = error instanceof Error ? error : new Error("Unknown error");
          setState((prev) => ({ ...prev, error: err, isFetching: false }));
          onError?.(err);
        }
      }
      pendingRequestRef.current = null;
      return;
    }

    if (!onLoadMore) {
      return;
    }

    setState((prev) => ({ ...prev, isFetching: true }));

    try {
      const promise = onLoadMore(nextPage, pageSize);
      pendingRequestRef.current = { page: nextPage, promise };

      const newItems = await promise;

      if (!isMountedRef.current) {
        return;
      }

      const hasMoreData = newItems.length === pageSize;
      setState((prev) => ({
        ...prev,
        data: pruneData([...prev.data, ...newItems], maxItems),
        page: nextPage,
        hasMore: hasMoreData,
        isFetching: false,
        error: null,
      }));

      loadedPagesRef.current.add(nextPage);
    } catch (error) {
      if (isMountedRef.current) {
        const err = error instanceof Error ? error : new Error("Failed to load more");
        setState((prev) => ({ ...prev, error: err, isFetching: false }));
        onError?.(err);
      }
    } finally {
      if (pendingRequestRef.current?.page === nextPage) {
        pendingRequestRef.current = null;
      }
    }
  }, [state.page, state.isFetching, state.isLoading, state.hasMore, onLoadMore, pageSize, maxItems, onError, pruneData]);

  /**
   * Refresh data (reset to page 1)
   */
  const refresh = useCallback(async () => {
    if (state.isLoading) {
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    loadedPagesRef.current.clear();
    pendingRequestRef.current = null;

    if (!onLoadMore) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      const newItems = await onLoadMore(1, pageSize);

      if (!isMountedRef.current) {
        return;
      }

      const hasMoreData = newItems.length === pageSize;
      setState((prev) => ({
        ...prev,
        data: newItems,
        page: 1,
        hasMore: hasMoreData,
        isLoading: false,
        error: null,
      }));

      loadedPagesRef.current.add(1);
    } catch (error) {
      if (isMountedRef.current) {
        const err = error instanceof Error ? error : new Error("Failed to refresh");
        setState((prev) => ({
          ...prev,
          error: err,
          isLoading: false,
        }));
        onError?.(err);
      }
    }
  }, [state.isLoading, onLoadMore, pageSize, onError]);

  /**
   * Reset to initial state
   */
  const reset = useCallback(() => {
    setState({
      data: initialData,
      isLoading: initialData.length === 0,
      isFetching: false,
      hasMore: true,
      error: null,
      page: 1,
    });
    loadedPagesRef.current.clear();
    loadedPagesRef.current.add(initialData.length > 0 ? 1 : 0);
    pendingRequestRef.current = null;
  }, [initialData]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      pendingRequestRef.current = null;
      loadedPagesRef.current.clear();
    };
  }, []);

  return {
    ...state,
    loadMore,
    refresh,
    reset,
  };
};
