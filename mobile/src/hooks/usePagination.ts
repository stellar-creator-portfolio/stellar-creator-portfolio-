/**
 * usePagination — Helper hook for managing pagination with memory optimization
 *
 * Features:
 *  - Simple pagination API
 *  - Automatic memory pressure handling
 *  - Built-in cache management
 *  - Error recovery
 */

import { useCallback, useRef, useState, useEffect } from "react";
import {
  ItemMemoryCache,
  BatchCleanupProcessor,
  MemoryMonitor,
} from "../utils/memoryOptimization";

export interface PaginationConfig {
  pageSize: number;
  maxItems?: number;
  enableMemoryManagement?: boolean;
}

export interface PaginationState {
  items: any[];
  currentPage: number;
  isLoading: boolean;
  isFetching: boolean;
  hasMore: boolean;
  error: Error | null;
  itemCount: number;
}

interface CachedItem {
  data: any;
  timestamp: number;
}

export const usePagination = (config: PaginationConfig) => {
  const {
    pageSize = 20,
    maxItems = 1000,
    enableMemoryManagement = true,
  } = config;

  const [state, setState] = useState<PaginationState>({
    items: [],
    currentPage: 1,
    isLoading: true,
    isFetching: false,
    hasMore: true,
    error: null,
    itemCount: 0,
  });

  // Memory management
  const cacheRef = useRef(
    new ItemMemoryCache<CachedItem>({ maxItemsInMemory: maxItems })
  );
  const cleanupProcessorRef = useRef(new BatchCleanupProcessor());
  const monitorRef = useRef(new MemoryMonitor({ maxItemsInMemory: maxItems }));
  const isMountedRef = useRef(true);
  const requestAbortControllerRef = useRef<AbortController | null>(null);

  /**
   * Fetch page with optional abort capability
   */
  const fetchPage = useCallback(
    async (
      page: number,
      fetcher: (page: number, pageSize: number) => Promise<any[]>
    ) => {
      if (state.isFetching) {
        return;
      }

      const isFirstPage = page === 1;
      const isFetching = !isFirstPage;

      setState((prev) => ({
        ...prev,
        [isFirstPage ? "isLoading" : "isFetching"]: true,
        error: null,
      }));

      requestAbortControllerRef.current = new AbortController();

      try {
        const newItems = await fetcher(page, pageSize);

        if (!isMountedRef.current) {
          return;
        }

        // Check for abort
        if (requestAbortControllerRef.current?.signal.aborted) {
          return;
        }

        const hasMoreData = newItems.length === pageSize;
        const allItems = isFirstPage
          ? newItems
          : [...state.items, ...newItems];

        // Check memory pressure
        const stats = cacheRef.current.getStats();
        monitorRef.current.setMemoryPressure(stats.utilizationPercent);

        if (monitorRef.current.isLowMemoryState() && enableMemoryManagement) {
          // Prune old items
          const pruned = allItems.slice(-maxItems);
          setState((prev) => ({
            ...prev,
            items: pruned,
            currentPage: page,
            hasMore: hasMoreData,
            [isFirstPage ? "isLoading" : "isFetching"]: false,
            itemCount: pruned.length,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            items: allItems,
            currentPage: page,
            hasMore: hasMoreData,
            [isFirstPage ? "isLoading" : "isFetching"]: false,
            itemCount: allItems.length,
          }));
        }

        // Cache items
        newItems.forEach((item, idx) => {
          const cacheKey = `${page}-${idx}`;
          cacheRef.current.set(cacheKey, {
            data: item,
            timestamp: Date.now(),
          });
        });
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        const err = error instanceof Error ? error : new Error("Unknown error");

        if (err.message !== "AbortError") {
          setState((prev) => ({
            ...prev,
            error: err,
            [isFirstPage ? "isLoading" : "isFetching"]: false,
          }));
        }
      } finally {
        requestAbortControllerRef.current = null;
      }
    },
    [state.isFetching, state.items, pageSize, maxItems, enableMemoryManagement]
  );

  /**
   * Load next page
   */
  const nextPage = useCallback(
    async (fetcher: (page: number, pageSize: number) => Promise<any[]>) => {
      if (state.isFetching || !state.hasMore) {
        return;
      }

      await fetchPage(state.currentPage + 1, fetcher);
    },
    [state.currentPage, state.isFetching, state.hasMore, fetchPage]
  );

  /**
   * Load first page
   */
  const reset = useCallback(
    async (fetcher: (page: number, pageSize: number) => Promise<any[]>) => {
      // Cancel any pending requests
      requestAbortControllerRef.current?.abort();

      await fetchPage(1, fetcher);
    },
    [fetchPage]
  );

  /**
   * Get cached item if available
   */
  const getCachedItem = useCallback((page: number, index: number) => {
    const cached = cacheRef.current.get(`${page}-${index}`);
    return cached?.data;
  }, []);

  /**
   * Clear cache and cleanup
   */
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
    cleanupProcessorRef.current.clear();
  }, []);

  /**
   * Get memory stats
   */
  const getMemoryStats = useCallback(() => {
    return {
      cache: cacheRef.current.getStats(),
      itemsInMemory: state.items.length,
      estimatedMemoryUsage: `~${(state.items.length * 1024) / 1024}KB`,
    };
  }, [state.items.length]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      requestAbortControllerRef.current?.abort();
      cleanupProcessorRef.current.clear();
      cacheRef.current.clear();
      monitorRef.current.stop();
    };
  }, []);

  /**
   * Start memory monitoring
   */
  useEffect(() => {
    if (enableMemoryManagement) {
      monitorRef.current.start(5000);
      return () => {
        monitorRef.current.stop();
      };
    }
  }, [enableMemoryManagement]);

  return {
    ...state,
    nextPage,
    reset,
    getCachedItem,
    clearCache,
    getMemoryStats,
  };
};
