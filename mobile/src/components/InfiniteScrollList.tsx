/**
 * InfiniteScrollList — Optimized infinite scrolling FlatList
 *
 * Features:
 *  - Memory-efficient rendering with recycling
 *  - Zero frame drops through getItemLayout and removeClippedSubviews
 *  - Configurable scroll thresholds for eager loading
 *  - Automatic content size tracking
 *  - Pull-to-refresh support
 *  - Loading states and error handling
 *  - Accessibility labels
 */

import React, {
  useCallback,
  useRef,
  useMemo,
  ReactNode,
  forwardRef,
  Ref,
} from "react";
import {
  FlatList,
  FlatListProps,
  RefreshControl,
  ActivityIndicator,
  View,
  StyleSheet,
  Text,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewToken,
} from "react-native";
import { useInfiniteScroll, InfiniteScrollConfig } from "../hooks/useInfiniteScroll";

export interface InfiniteScrollListProps<T> extends Omit<FlatListProps<T>, 'data' | 'renderItem'> {
  // Infinite scroll configuration
  infiniteConfig: InfiniteScrollConfig;

  // Rendering
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;

  // Item layout optimization
  itemHeight?: number; // Set for getItemLayout optimization
  estimatedItemSize?: number; // For estimating initial list size

  // Scroll behavior
  scrollThreshold?: number; // 0-1, default 0.5. Load more when scrolled to this percentage
  scrollEnabled?: boolean;
  scrollEventThrottle?: number;

  // Performance
  maxToRenderPerBatch?: number;
  updateCellsBatchingPeriod?: number;
  removeClippedSubviews?: boolean;
  viewabilityConfig?: {
    minimumViewTime?: number;
    viewAreaCoveragePercentThreshold?: number;
  };

  // Loading and error states
  loadingComponent?: ReactNode;
  errorComponent?: (error: Error, retry: () => void) => ReactNode;
  emptyComponent?: ReactNode;

  // Client-side filter applied after pagination (does not affect memory cap)
  filterFn?: (item: T) => boolean;

  // Callbacks
  onLoadMore?: () => void;
  onRefresh?: () => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onViewableItemsChanged?: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
}

interface InfiniteScrollListHandle {
  scrollToTop: () => void;
  scrollToEnd: () => void;
  scrollToItem: (index: number) => void;
}

const DefaultLoadingComponent = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#4f46e5" />
  </View>
);

const DefaultErrorComponent = ({ error, retry }: { error: Error; retry: () => void }) => (
  <View style={styles.errorContainer}>
    <Text style={styles.errorText}>Failed to load: {error.message}</Text>
    <Text
      style={[styles.errorText, styles.retryButton]}
      onPress={retry}
      accessible={true}
      accessibilityLabel="Retry loading"
      accessibilityRole="button"
    >
      Retry
    </Text>
  </View>
);

const DefaultEmptyComponent = () => (
  <View style={styles.emptyContainer}>
    <Text style={styles.emptyText}>No items to display</Text>
  </View>
);

export const InfiniteScrollList = forwardRef<
  InfiniteScrollListHandle,
  InfiniteScrollListProps<any>
>(
  (
    {
      infiniteConfig,
      renderItem,
      keyExtractor,
      itemHeight,
      estimatedItemSize = 100,
      scrollThreshold = 0.5,
      scrollEnabled = true,
      scrollEventThrottle = 16,
      maxToRenderPerBatch = 10,
      updateCellsBatchingPeriod = 50,
      removeClippedSubviews = true,
      viewabilityConfig,
      loadingComponent = <DefaultLoadingComponent />,
      errorComponent,
      emptyComponent = <DefaultEmptyComponent />,
      filterFn,
      onLoadMore,
      onRefresh,
      onScroll,
      onViewableItemsChanged,
      ...restProps
    },
    ref: Ref<InfiniteScrollListHandle>
  ) => {
    const flatListRef = useRef<FlatList>(null);
    const scrollOffsetRef = useRef(0);
    const contentSizeRef = useRef(0);

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
     * Handle end reached with configurable threshold
     */
    const handleEndReached = useCallback(() => {
      if (isFetching || !hasMore || isLoading) {
        return;
      }
      loadMore();
      onLoadMore?.();
    }, [isFetching, hasMore, isLoading, loadMore, onLoadMore]);

    /**
     * Handle refresh control pull-down
     */
    const handleRefresh = useCallback(async () => {
      await refresh();
      onRefresh?.();
    }, [refresh, onRefresh]);

    /**
     * Handle scroll with threshold-based loading
     */
    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        scrollOffsetRef.current = contentOffset.y;
        contentSizeRef.current = contentSize.height;

        // Calculate scroll position as percentage
        const scrolledPercentage =
          (contentOffset.y + layoutMeasurement.height) / contentSize.height;

        // Load more if crossed threshold
        if (scrolledPercentage >= scrollThreshold) {
          handleEndReached();
        }

        onScroll?.(event);
      },
      [scrollThreshold, handleEndReached, onScroll]
    );

    /**
     * Optimized item layout for FlatList
     */
    const getItemLayout = useCallback(
      (data: any, index: number) => {
        if (!itemHeight) {
          return undefined;
        }
        return {
          length: itemHeight,
          offset: itemHeight * index,
          index,
        };
      },
      [itemHeight]
    );

    /**
     * Memoized render item with proper keys
     */
    const memoizedRenderItem = useCallback(
      ({ item, index }: { item: any; index: number }) => {
        return (
          <View
            key={keyExtractor(item, index)}
            accessible={true}
            accessibilityRole="listitem"
          >
            {renderItem(item, index)}
          </View>
        );
      },
      [renderItem, keyExtractor]
    );

    /**
     * Footer component with loading indicator
     */
    const renderFooter = useMemo(() => {
      if (!hasMore && data.length === 0) {
        return null;
      }

      if (isFetching) {
        return (
          <View style={styles.footerContainer} accessibilityLabel="Loading more items">
            <ActivityIndicator size="small" color="#4f46e5" />
          </View>
        );
      }

      if (!hasMore && data.length > 0) {
        return (
          <View style={styles.endMessageContainer}>
            <Text style={styles.endMessageText}>No more items</Text>
          </View>
        );
      }

      return null;
    }, [isFetching, hasMore, data.length]);

    /**
     * Error state rendering
     */
    const errorContent = useMemo(() => {
      if (!error) {
        return null;
      }

      if (errorComponent) {
        return errorComponent(error, refresh);
      }

      return <DefaultErrorComponent error={error} retry={refresh} />;
    }, [error, refresh, errorComponent]);

    /**
     * Empty state rendering
     */
    const emptyContent = useMemo(() => {
      if (data.length > 0) {
        return null;
      }

      if (isLoading) {
        return loadingComponent;
      }

      if (error) {
        return errorContent;
      }

      return emptyComponent;
    }, [data.length, isLoading, error, errorContent, loadingComponent, emptyComponent]);

    /**
     * Exposed ref methods
     */
    React.useImperativeHandle(ref, () => ({
      scrollToTop: () => {
        flatListRef.current?.scrollToIndex({ index: 0, animated: true });
      },
      scrollToEnd: () => {
        flatListRef.current?.scrollToEnd({ animated: true });
      },
      scrollToItem: (index: number) => {
        flatListRef.current?.scrollToIndex({ index, animated: true });
      },
    }));

    const viewabilityConfigCallbackPairs = useRef([
      {
        viewabilityConfig: viewabilityConfig || {
          minimumViewTime: 100,
          viewAreaCoveragePercentThreshold: 10,
        },
        onViewableItemsChanged: onViewableItemsChanged || (() => {}),
      },
    ]);

    return (
      <FlatList<any>
        ref={flatListRef}
        data={data}
        renderItem={memoizedRenderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        estimatedItemSize={estimatedItemSize}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={emptyContent}
        onEndReached={handleEndReached}
        onEndReachedThreshold={scrollThreshold}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && data.length > 0}
            onRefresh={handleRefresh}
            enabled={scrollEnabled}
            colors={["#4f46e5"]}
          />
        }
        scrollEnabled={scrollEnabled}
        maxToRenderPerBatch={maxToRenderPerBatch}
        updateCellsBatchingPeriod={updateCellsBatchingPeriod}
        removeClippedSubviews={removeClippedSubviews}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs.current}
        shouldItemUpdate={(prev, next) => prev !== next}
        accessibilityLabel="Scrollable content list"
        {...restProps}
      />
    );
  }
);

InfiniteScrollList.displayName = "InfiniteScrollList";

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 20,
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
  footerContainer: {
    paddingVertical: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  endMessageContainer: {
    paddingVertical: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  endMessageText: {
    fontSize: 14,
    color: "#9ca3af",
  },
});
