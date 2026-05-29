/**
 * INFINITE SCROLLING IMPLEMENTATION GUIDE
 * 
 * This document provides a comprehensive guide for implementing
 * memory-optimized infinite scrolling in the Stellar mobile app.
 * 
 * Files Created:
 * ├── hooks/
 * │   ├── useInfiniteScroll.ts       (Infinite scroll state management)
 * │   └── usePagination.ts           (Pagination with memory management)
 * ├── utils/
 * │   └── memoryOptimization.ts      (Memory utilities and LRU cache)
 * ├── components/
 * │   ├── InfiniteScrollList.tsx     (FlatList wrapper with optimization)
 * │   └── VirtualizedScrollList.tsx  (VirtualizedList for large datasets)
 * └── screens/
 *     └── FreelancerDirectoryEnhanced.tsx (Example with full features)
 */

/**
 * QUICK START GUIDE
 * ================
 * 
 * 1. Basic Infinite Scroll with FlatList:
 * 
 *    import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
 *    import { InfiniteScrollList } from '../components/InfiniteScrollList';
 *    
 *    function MyScreen() {
 *      const { data, isFetching, loadMore } = useInfiniteScroll({
 *        pageSize: 20,
 *        maxItems: 500,
 *        onLoadMore: async (page, pageSize) => {
 *          const response = await api.getItems(page, pageSize);
 *          return response.items;
 *        },
 *      });
 *      
 *      return (
 *        <InfiniteScrollList
 *          infiniteConfig={{
 *            pageSize: 20,
 *            onLoadMore: async (page, pageSize) => {
 *              const response = await api.getItems(page, pageSize);
 *              return response.items;
 *            },
 *          }}
 *          renderItem={(item, index) => <ItemCard item={item} />}
 *          keyExtractor={(item) => item.id}
 *          itemHeight={120}
 *        />
 *      );
 *    }
 */

/**
 * 2. For Large Datasets (1000+ items), use VirtualizedScrollList:
 * 
 *    import { VirtualizedScrollList } from '../components/VirtualizedScrollList';
 *    
 *    <VirtualizedScrollList
 *      infiniteConfig={{
 *        pageSize: 50,
 *        maxItems: 1000,
 *        onLoadMore: async (page, pageSize) => {
 *          const response = await api.getItems(page, pageSize);
 *          return response.items;
 *        },
 *      }}
 *      renderItem={(item, index) => <ItemCard item={item} />}
 *      keyExtractor={(item) => item.id}
 *      itemHeight={100}
 *      windowSize={15}
 *    />
 */

/**
 * 3. With Memory Management (Pagination Hook):
 * 
 *    import { usePagination } from '../hooks/usePagination';
 *    
 *    function MyScreen() {
 *      const {
 *        items,
 *        currentPage,
 *        isLoading,
 *        nextPage,
 *        reset,
 *        getMemoryStats,
 *      } = usePagination({
 *        pageSize: 30,
 *        maxItems: 500,
 *        enableMemoryManagement: true,
 *      });
 *      
 *      const handleLoadMore = () => {
 *        nextPage(async (page, size) => {
 *          const response = await api.getItems(page, size);
 *          return response.items;
 *        });
 *      };
 *      
 *      // Check memory usage
 *      const stats = getMemoryStats();
 *      console.log(`Memory usage: ${stats.estimatedMemoryUsage}`);
 *    }
 */

/**
 * KEY CONCEPTS
 * ============
 */

/**
 * A. useInfiniteScroll Hook
 * 
 * State Management:
 *   - data: Current list of items
 *   - isLoading: Initial load state
 *   - isFetching: Subsequent page load state
 *   - hasMore: Whether more items exist
 *   - error: Load error if any
 *   - page: Current page number
 * 
 * Methods:
 *   - loadMore(): Fetch next page
 *   - refresh(): Reset and reload from page 1
 *   - reset(): Reset to initial state
 * 
 * Config Options:
 *   - pageSize: Items per page (default: 20)
 *   - maxItems: Max items in memory (0 = unlimited)
 *   - initialData: Starting items
 *   - onLoadMore: Async function to fetch data
 *   - onError: Error callback
 * 
 * Memory Features:
 *   - Automatic LRU eviction when maxItems exceeded
 *   - Request deduplication (prevents duplicate page loads)
 *   - Cleanup on unmount
 *   - Pending request tracking
 */

/**
 * B. InfiniteScrollList Component
 * 
 * A FlatList wrapper with:
 *   - Optimized rendering (getItemLayout, removeClippedSubviews)
 *   - Zero frame drops through memoization
 *   - Configurable scroll threshold (0-1)
 *   - Pull-to-refresh support
 *   - Error and empty states
 *   - Accessibility labels
 * 
 * Best for:
 *   - Lists with 100-500 items
 *   - Dynamic item heights (use estimatedItemSize)
 *   - Filtering/searching (data is filtered in hook)
 * 
 * Performance:
 *   - maxToRenderPerBatch: 10 (default)
 *   - updateCellsBatchingPeriod: 50ms (default)
 *   - scrollEventThrottle: 16ms (default)
 */

/**
 * C. VirtualizedScrollList Component
 * 
 * VirtualizedList wrapper with:
 *   - Virtual rendering (only visible items rendered)
 *   - Minimal memory footprint
 *   - Handles 1000+ items efficiently
 *   - Configurable window size
 *   - Automatic viewport caching
 * 
 * Best for:
 *   - Very long lists (500+)
 *   - Dynamic content
 *   - Search/filter with many results
 * 
 * Performance:
 *   - windowSize: 10 items (customizable)
 *   - initialNumToRender: 10 items
 *   - maxToRenderPerBatch: 5 (reduced for virtual)
 */

/**
 * D. Memory Optimization Utilities
 * 
 * ItemMemoryCache:
 *   - LRU (Least Recently Used) cache
 *   - Auto-eviction at maxItems
 *   - getStats() returns utilization
 * 
 * BatchCleanupProcessor:
 *   - Batch cleanup tasks
 *   - Prevents jank from bulk operations
 *   - Configurable batch size and delay
 * 
 * MemoryMonitor:
 *   - Memory pressure detection
 *   - Low memory state tracking
 *   - Listener subscriptions
 * 
 * Usage:
 *   const cache = new ItemMemoryCache({ maxItemsInMemory: 1000 });
 *   const processor = new BatchCleanupProcessor(50, 100);
 *   const monitor = new MemoryMonitor();
 */

/**
 * PERFORMANCE OPTIMIZATION TIPS
 * ==============================
 */

/**
 * 1. Optimize renderItem
 * 
 * ✅ DO:
 *    const renderItem = useCallback(
 *      ({ item }) => <ItemCard item={item} />,
 *      []
 *    );
 * 
 * ❌ DON'T:
 *    renderItem={({ item }) => <ItemCard item={item} />}
 */

/**
 * 2. Use Proper Key Extraction
 * 
 * ✅ DO:
 *    keyExtractor={(item, index) => item.id}
 * 
 * ❌ DON'T:
 *    keyExtractor={(item, index) => index}
 */

/**
 * 3. Set itemHeight When Known
 * 
 * ✅ DO:
 *    itemHeight={100} // Enables getItemLayout optimization
 * 
 * ❌ DON'T:
 *    Let FlatList measure every item
 */

/**
 * 4. Memoize Components
 * 
 * ✅ DO:
 *    const ItemCard = React.memo(({ item }) => ...)
 * 
 * ❌ DON'T:
 *    Define component inline in render
 */

/**
 * 5. Limit Initial Render
 * 
 * ✅ DO:
 *    initialNumToRender={10}  // Start with 10, load more as needed
 * 
 * ❌ DON'T:
 *    Render all items on first load
 */

/**
 * 6. Use maxToRenderPerBatch Wisely
 * 
 * For 60fps on most devices:
 * - FlatList: maxToRenderPerBatch={10}
 * - VirtualizedList: maxToRenderPerBatch={5}
 * 
 * Adjust based on item complexity
 */

/**
 * 7. Set Appropriate maxItems
 * 
 * Guide:
 * - Lightweight items (text): 1000
 * - Medium items (with images): 500
 * - Heavy items (complex UI): 200
 * - Very heavy (video previews): 100
 */

/**
 * 8. Use Search Wisely
 * 
 * ✅ DO:
 *    const filtered = useMemo(() => {
 *      return items.filter(/* ... */);
 *    }, [items, searchQuery]);
 * 
 * ❌ DON'T:
 *    Fetch new data on each character typed
 */

/**
 * MEMORY MONITORING
 * =================
 * 
 * Check cache statistics:
 *    const cache = cacheRef.current;
 *    const stats = cache.getStats();
 *    console.log(`Size: ${stats.size}/${stats.maxSize}`);
 *    console.log(`Utilization: ${stats.utilizationPercent}%`);
 * 
 * Monitor memory pressure:
 *    useEffect(() => {
 *      const unsubscribe = monitor.onMemoryPressure((isLow) => {
 *        console.log(`Low memory: ${isLow}`);
 *        if (isLow) {
 *          // Clear some cache, reduce batch size, etc.
 *        }
 *      });
 *      return unsubscribe;
 *    }, []);
 */

/**
 * COMMON PATTERNS
 * ===============
 */

/**
 * Pattern 1: Search + Infinite Scroll
 * 
 * const [search, setSearch] = useState('');
 * const { data, loadMore } = useInfiniteScroll({...});
 * 
 * const filtered = useMemo(() => {
 *   return data.filter(item =>
 *     item.name.includes(search.toLowerCase())
 *   );
 * }, [data, search]);
 * 
 * <InfiniteScrollList
 *   infiniteConfig={...}
 *   data={filtered}
 *   {...}
 * />
 */

/**
 * Pattern 2: Pull-to-Refresh + Infinite Scroll
 * 
 * const { data, refresh, loadMore } = useInfiniteScroll({...});
 * 
 * <InfiniteScrollList
 *   infiniteConfig={{...}}
 *   onRefresh={refresh}
 *   onLoadMore={loadMore}
 *   {...}
 * />
 */

/**
 * Pattern 3: Error Recovery
 * 
 * const { error, loadMore } = useInfiniteScroll({...});
 * 
 * if (error) {
 *   return (
 *     <View>
 *       <Text>{error.message}</Text>
 *       <Button title="Retry" onPress={loadMore} />
 *     </View>
 *   );
 * }
 */

/**
 * TROUBLESHOOTING
 * ===============
 */

/**
 * Q: List is laggy when scrolling
 * A: 
 *   1. Reduce maxToRenderPerBatch (default 10 → 5)
 *   2. Increase updateCellsBatchingPeriod (default 50 → 100)
 *   3. Ensure renderItem is memoized
 *   4. Set itemHeight if possible
 *   5. Use VirtualizedScrollList for large lists
 */

/**
 * Q: Memory keeps growing
 * A:
 *   1. Set maxItems to reasonable value (not 0)
 *   2. Check getStats() to see cache size
 *   3. Reduce pageSize if loading huge amounts
 *   4. Use VirtualizedList instead of FlatList
 *   5. Profile with React DevTools Profiler
 */

/**
 * Q: List jumps or flickers on load
 * A:
 *   1. Set estimatedItemSize correctly
 *   2. Use getItemLayout when itemHeight is fixed
 *   3. Increase initialNumToRender
 *   4. Avoid setState changes in renderItem
 */

/**
 * Q: Filters don't work with infinite scroll
 * A:
 *   - Filter in useMemo, not in hook
 *   - Reset pagination when filter changes
 *   - Consider resetting with refresh()
 */

/**
 * TESTING
 * =======
 * 
 * Test memory pressure:
 *   - Reduce maxItems to force eviction
 *   - Monitor cache.getStats()
 *   - Check for memory leaks
 * 
 * Test performance:
 *   - Use React DevTools Profiler
 *   - Monitor frame rate
 *   - Check render times
 * 
 * Test edge cases:
 *   - Empty list
 *   - Single item
 *   - Network errors
 *   - Rapid scrolling
 */

/**
 * REFERENCES
 * ==========
 * 
 * - React Native FlatList: https://reactnative.dev/docs/flatlist
 * - React Native VirtualizedList: https://reactnative.dev/docs/virtualizedlist
 * - Memory Best Practices: https://reactnative.dev/docs/memory-profiling
 * - Performance: https://reactnative.dev/docs/performance
 */

export {};
