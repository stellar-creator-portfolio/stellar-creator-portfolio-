/**
 * VirtualizedScrollList — Ultra-optimized for very long lists
 *
 * Features:
 *  - Virtual rendering only visible items
 *  - Minimal memory footprint
 *  - High performance with thousands of items
 *  - Configurable window size
 *  - Automatic viewport caching
 */

import React, {
  useCallback,
  useRef,
  useMemo,
  ReactNode,
  forwardRef,
  Ref,
  useState,
  useEffect,
} from "react";
import {
  VirtualizedList,
  VirtualizedListProps,
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
} from "react-native";
import { useInfiniteScroll, InfiniteScrollConfig } from "../hooks/useInfiniteScroll";

export interface VirtualizedScrollListProps<T>
  extends Omit<VirtualizedListProps<T>, 'data' | 'renderItem' | 'getItem' | 'getItemCount'> {
  // Infinite scroll configuration
  infiniteConfig: InfiniteScrollConfig;

  // Rendering
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;

  // Item layout optimization
  itemHeight?: number;
  estimatedItemSize?: number;

  // Virtual rendering
  windowSize?: number; // Number of items to render outside viewport
  initialNumToRender?: number;
  maxToRenderPerBatch?: number;
  updateCellsBatchingPeriod?: number;

  // Scroll behavior
  scrollEnabled?: boolean;
  scrollEventThrottle?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

  // Loading and error states
  loadingComponent?: ReactNode;
  errorComponent?: (error: Error, retry: () => void) => ReactNode;
  emptyComponent?: ReactNode;

  // Client-side filter applied after pagination (does not affect memory cap)
  filterFn?: (item: T) => boolean;

  // Callbacks
  onLoadMore?: () => void;
  onRefresh?: () => void;
}

interface VirtualizedScrollListHandle {
  scrollToIndex: (index: number) => void;
  scrollToTop: () => void;
  scrollToEnd: () => void;
}

const DefaultLoadingComponent = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#4f46e5" />
  </View>
);

const DefaultEmptyComponent = () => (
  <View style={styles.emptyContainer}>
    <Text style={styles.emptyText}>No items to display</Text>
  </View>
);

export const VirtualizedScrollList = forwardRef<
  VirtualizedScrollListHandle,
  VirtualizedScrollListProps<any>
>(
  (
    {
      infiniteConfig,
      renderItem,
      keyExtractor,
      itemHeight = 80,
      estimatedItemSize = 80,
      windowSize = 10,
      initialNumToRender = 10,
      maxToRenderPerBatch = 5,
      updateCellsBatchingPeriod = 50,
      scrollEnabled = true,
      scrollEventThrottle = 16,
      onScroll,
      loadingComponent = <DefaultLoadingComponent />,
      errorComponent,
      emptyComponent = <DefaultEmptyComponent />,
      filterFn,
      onLoadMore,
      onRefresh,
      ...restProps
    },
    ref: Ref<VirtualizedScrollListHandle>
  ) => {
    const virtualListRef = useRef<VirtualizedList>(null);
    const scrollPositionRef = useRef(0);
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);

    // Infinite scroll state management
    const {
      data: rawData,
      isLoading,
      isFetching,
      hasMore,
      error,
      loadMore,
      refresh,
    } = useInfiniteScroll(infiniteConfig);

    const data = useMemo(
      () => (filterFn ? rawData.filter(filterFn) : rawData),
      [rawData, filterFn]
    );

    /**
     * VirtualizedList required: get item count
     */
    const getItemCount = useCallback(() => {
      return data.length + (isFetching ? 1 : 0);
    }, [data.length, isFetching]);

    /**
     * VirtualizedList required: get specific item
     */
    const getItem = useCallback(
      (items: any[], index: number) => {
        if (index >= items.length) {
          return { isLoading: true };
        }
        return items[index];
      },
      []
    );

    /**
     * Handle scroll with dynamic load more
     */
    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        scrollPositionRef.current = contentOffset.y;

        const scrolledPercentage =
          (contentOffset.y + layoutMeasurement.height) / contentSize.height;

        // Load more at 70% scroll
        if (scrolledPercentage >= 0.7 && hasMore && !isFetching && !isLoading) {
          loadMore();
          onLoadMore?.();
        }

        onScroll?.(event);
      },
      [hasMore, isFetching, isLoading, loadMore, onLoadMore, onScroll]
    );

    /**
     * Handle manual refresh
     */
    const handleRefresh = useCallback(async () => {
      setIsManualRefreshing(true);
      await refresh();
      setIsManualRefreshing(false);
      onRefresh?.();
    }, [refresh, onRefresh]);

    /**
     * Memoized render item
     */
    const memoizedRenderItem = useCallback(
      ({ item, index }: { item: any; index: number }) => {
        if (item.isLoading) {
          return (
            <View style={[styles.itemContainer, { height: itemHeight }]}>
              <ActivityIndicator size="small" color="#4f46e5" />
            </View>
          );
        }

        return (
          <View
            style={[styles.itemContainer, { minHeight: itemHeight }]}
            key={keyExtractor(item, index)}
            accessible={true}
            accessibilityRole="listitem"
          >
            {renderItem(item, index)}
          </View>
        );
      },
      [itemHeight, renderItem, keyExtractor]
    );

    /**
     * Render footer with end message
     */
    const renderFooter = useMemo(() => {
      if (data.length === 0) return null;

      if (isFetching) {
        return (
          <View style={styles.footerContainer}>
            <ActivityIndicator size="small" color="#4f46e5" />
          </View>
        );
      }

      if (!hasMore) {
        return (
          <View style={styles.endMessageContainer}>
            <Text style={styles.endMessageText}>No more items to load</Text>
          </View>
        );
      }

      return null;
    }, [isFetching, hasMore, data.length]);

    /**
     * Handle error display
     */
    const renderError = useMemo(() => {
      if (!error) return null;

      if (errorComponent) {
        return errorComponent(error, refresh);
      }

      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load items</Text>
          <Text
            style={[styles.errorText, styles.retryButton]}
            onPress={refresh}
            accessible={true}
            accessibilityLabel="Retry loading"
            accessibilityRole="button"
          >
            Retry
          </Text>
        </View>
      );
    }, [error, errorComponent, refresh]);

    /**
     * Render empty state
     */
    const renderEmpty = useMemo(() => {
      if (data.length > 0) return null;

      if (isLoading) {
        return loadingComponent;
      }

      if (error) {
        return renderError;
      }

      return emptyComponent;
    }, [data.length, isLoading, error, renderError, loadingComponent, emptyComponent]);

    /**
     * Exposed ref methods
     */
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: (index: number) => {
        virtualListRef.current?.scrollToIndex({ index, animated: true });
      },
      scrollToTop: () => {
        virtualListRef.current?.scrollToIndex({ index: 0, animated: true });
      },
      scrollToEnd: () => {
        if (data.length > 0) {
          virtualListRef.current?.scrollToEnd({ animated: true });
        }
      },
    }));

    return (
      <VirtualizedList
        ref={virtualListRef}
        data={data}
        renderItem={memoizedRenderItem}
        keyExtractor={keyExtractor}
        getItemCount={getItemCount}
        getItem={getItem}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={isManualRefreshing || (isLoading && data.length > 0)}
            onRefresh={handleRefresh}
            enabled={scrollEnabled}
            colors={["#4f46e5"]}
          />
        }
        scrollEnabled={scrollEnabled}
        windowSize={windowSize}
        initialNumToRender={initialNumToRender}
        maxToRenderPerBatch={maxToRenderPerBatch}
        updateCellsBatchingPeriod={updateCellsBatchingPeriod}
        accessibilityLabel="Virtualized scrollable list"
        accessibilityRole="list"
        {...restProps}
      />
    );
  }
);

VirtualizedScrollList.displayName = "VirtualizedScrollList";

const styles = StyleSheet.create({
  itemContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#9ca3af",
  },
  errorContainer: {
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginVertical: 4,
  },
  retryButton: {
    color: "#4f46e5",
    fontWeight: "600",
    marginTop: 12,
  },
  footerContainer: {
    paddingVertical: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  endMessageContainer: {
    paddingVertical: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  endMessageText: {
    fontSize: 13,
    color: "#9ca3af",
  },
});
