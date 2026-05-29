/**
 * PRACTICAL EXAMPLES
 * Example implementations showing real-world usage patterns
 */

/**
 * Example 1: Product List with Infinite Scroll
 * Shows: Basic infinite scroll with FlatList
 */

import React, { useCallback } from "react";
import { View, SafeAreaView } from "react-native";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { InfiniteScrollList } from "../components/InfiniteScrollList";

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
}

// Mock API
const mockApiGetProducts = async (
  page: number,
  pageSize: number
): Promise<Product[]> => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Generate mock data
  const items: Product[] = [];
  for (let i = 0; i < pageSize; i++) {
    const index = (page - 1) * pageSize + i;
    items.push({
      id: `product-${index}`,
      name: `Product ${index + 1}`,
      price: Math.floor(Math.random() * 10000) / 100,
      image: `https://via.placeholder.com/200`,
    });
  }

  // Simulate "no more items" after 100 items
  if ((page - 1) * pageSize >= 100) {
    return [];
  }

  return items;
};

export function ProductListExample() {
  const renderProduct = useCallback((product: Product) => {
    return (
      <View
        style={{
          padding: 12,
          backgroundColor: "#f3f4f6",
          marginHorizontal: 12,
          marginVertical: 6,
          borderRadius: 8,
        }}
      >
        <View style={{ fontSize: 16, fontWeight: "bold" }}>
          {product.name}
        </View>
        <View style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
          ${product.price}
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <InfiniteScrollList
        infiniteConfig={{
          pageSize: 20,
          maxItems: 300,
          onLoadMore: mockApiGetProducts,
        }}
        renderItem={renderProduct}
        keyExtractor={(item) => item.id}
        itemHeight={80}
        scrollThreshold={0.7}
      />
    </SafeAreaView>
  );
}

/**
 * Example 2: Search with Infinite Scroll
 * Shows: Combining search filters with pagination
 */

import { useState, useMemo } from "react";
import { TextInput } from "react-native";

interface User {
  id: string;
  name: string;
  email: string;
}

const mockApiGetUsers = async (
  page: number,
  pageSize: number
): Promise<User[]> => {
  await new Promise((resolve) => setTimeout(resolve, 400));

  const users: User[] = [];
  for (let i = 0; i < pageSize; i++) {
    const index = (page - 1) * pageSize + i;
    users.push({
      id: `user-${index}`,
      name: `User ${index + 1}`,
      email: `user${index + 1}@example.com`,
    });
  }

  return users.length === pageSize ? users : [];
};

export function SearchableListExample() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data, loadMore, refresh } = useInfiniteScroll({
    pageSize: 25,
    maxItems: 500,
    onLoadMore: mockApiGetUsers,
  });

  // Filter data locally
  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return data.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query)
    );
  }, [data, searchQuery]);

  const renderUser = useCallback((user: User) => {
    return (
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }}>
        <View style={{ fontWeight: "bold" }}>{user.name}</View>
        <View style={{ color: "#6b7280", marginTop: 4 }}>{user.email}</View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <TextInput
        style={{
          margin: 12,
          padding: 12,
          borderWidth: 1,
          borderRadius: 8,
          borderColor: "#d1d5db",
        }}
        placeholder="Search users..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      <InfiniteScrollList
        infiniteConfig={{
          pageSize: 25,
          maxItems: 500,
          onLoadMore: mockApiGetUsers,
        }}
        renderItem={renderUser}
        keyExtractor={(item) => item.id}
        estimatedItemSize={80}
      />
    </SafeAreaView>
  );
}

/**
 * Example 3: Large Dataset with VirtualizedList
 * Shows: Using VirtualizedScrollList for 1000+ items
 */

import { VirtualizedScrollList } from "../components/VirtualizedScrollList";

interface Article {
  id: string;
  title: string;
  excerpt: string;
  date: string;
}

const mockApiGetArticles = async (
  page: number,
  pageSize: number
): Promise<Article[]> => {
  await new Promise((resolve) => setTimeout(resolve, 300));

  const articles: Article[] = [];
  for (let i = 0; i < pageSize; i++) {
    const index = (page - 1) * pageSize + i;
    articles.push({
      id: `article-${index}`,
      title: `Article ${index + 1}: Interesting Topic`,
      excerpt: `This is a brief excerpt from article ${index + 1}...`,
      date: new Date(Date.now() - Math.random() * 100 * 24 * 60 * 60 * 1000)
        .toLocaleDateString(),
    });
  }

  return articles;
};

export function LargeDatasetExample() {
  const renderArticle = useCallback((article: Article) => {
    return (
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }}>
        <View style={{ fontWeight: "bold", fontSize: 16 }}>{article.title}</View>
        <View style={{ color: "#6b7280", marginTop: 8 }}>{article.excerpt}</View>
        <View style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
          {article.date}
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <VirtualizedScrollList
        infiniteConfig={{
          pageSize: 50,
          maxItems: 1000,
          onLoadMore: mockApiGetArticles,
        }}
        renderItem={renderArticle}
        keyExtractor={(item) => item.id}
        itemHeight={120}
        windowSize={15}
      />
    </SafeAreaView>
  );
}

/**
 * Example 4: With Error Handling and Retry
 * Shows: Error states and recovery
 */

interface ApiResponse<T> {
  items: T[];
  error?: string;
}

const mockApiWithErrors = async (
  page: number,
  pageSize: number
): Promise<Product[]> => {
  // Simulate occasional network errors
  if (Math.random() > 0.8) {
    throw new Error("Network request failed");
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const items: Product[] = [];
  for (let i = 0; i < pageSize; i++) {
    const index = (page - 1) * pageSize + i;
    items.push({
      id: `product-${index}`,
      name: `Product ${index + 1}`,
      price: Math.floor(Math.random() * 10000) / 100,
      image: `https://via.placeholder.com/200`,
    });
  }

  return items;
};

export function ErrorHandlingExample() {
  const { data, error, loadMore, refresh } = useInfiniteScroll({
    pageSize: 20,
    maxItems: 300,
    onLoadMore: mockApiWithErrors,
    onError: (error) => {
      console.error("Failed to load items:", error.message);
    },
  });

  const renderProduct = useCallback((product: Product) => {
    return (
      <View style={{ padding: 12, backgroundColor: "#f3f4f6", margin: 6 }}>
        <View style={{ fontWeight: "bold" }}>{product.name}</View>
        <View style={{ color: "#6b7280", marginTop: 4 }}>${product.price}</View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {error && (
        <View style={{ backgroundColor: "#fee", padding: 12, margin: 12 }}>
          <View style={{ color: "#c00", fontWeight: "bold" }}>Error</View>
          <View style={{ color: "#c00", marginTop: 4 }}>{error.message}</View>
          <View
            onPress={loadMore}
            style={{
              marginTop: 8,
              padding: 8,
              backgroundColor: "#c00",
              borderRadius: 4,
            }}
          >
            <View style={{ color: "white", fontWeight: "bold" }}>Retry</View>
          </View>
        </View>
      )}
      <InfiniteScrollList
        infiniteConfig={{
          pageSize: 20,
          maxItems: 300,
          onLoadMore: mockApiWithErrors,
        }}
        renderItem={renderProduct}
        keyExtractor={(item) => item.id}
        itemHeight={80}
        errorComponent={(error, retry) => (
          <View style={{ padding: 20, alignItems: "center" }}>
            <View style={{ fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
              Failed to load more items
            </View>
            <View style={{ color: "#6b7280", marginBottom: 16 }}>
              {error.message}
            </View>
            <View
              onPress={retry}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                backgroundColor: "#4f46e5",
                borderRadius: 6,
              }}
            >
              <View style={{ color: "white", fontWeight: "bold" }}>Retry</View>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/**
 * Example 5: Memory-Aware Pagination
 * Shows: Using usePagination hook with memory monitoring
 */

import { usePagination } from "../hooks/usePagination";

interface Item {
  id: string;
  title: string;
  content: string;
}

export function MemoryAwareExample() {
  const {
    items,
    currentPage,
    isLoading,
    nextPage,
    reset,
    getMemoryStats,
  } = usePagination({
    pageSize: 30,
    maxItems: 500,
    enableMemoryManagement: true,
  });

  const handleLoadMore = useCallback(() => {
    nextPage(async (page, pageSize) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      // Generate items
      const newItems: Item[] = [];
      for (let i = 0; i < pageSize; i++) {
        const index = (page - 1) * pageSize + i;
        newItems.push({
          id: `item-${index}`,
          title: `Item ${index + 1}`,
          content: "Lorem ipsum dolor sit amet...",
        });
      }
      
      return newItems;
    });
  }, [nextPage]);

  const stats = getMemoryStats();

  const renderItem = useCallback((item: Item) => {
    return (
      <View style={{ padding: 12, backgroundColor: "#f3f4f6", margin: 8 }}>
        <View style={{ fontWeight: "bold" }}>{item.title}</View>
        <View style={{ color: "#6b7280", marginTop: 4 }}>{item.content}</View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* Memory stats */}
      <View style={{ padding: 12, backgroundColor: "#eff6ff", borderBottomWidth: 1 }}>
        <View style={{ fontSize: 12, color: "#0c4a6e" }}>
          Page: {currentPage} | Items: {items.length} | Memory: {stats.estimatedMemoryUsage}
        </View>
      </View>

      {/* Items list */}
      <View style={{ flex: 1 }}>
        {items.map((item) => (
          <View key={item.id}>{renderItem(item)}</View>
        ))}

        {!isLoading && (
          <View
            onPress={handleLoadMore}
            style={{
              padding: 16,
              alignItems: "center",
              backgroundColor: "#4f46e5",
              margin: 12,
              borderRadius: 8,
            }}
          >
            <View style={{ color: "white", fontWeight: "bold" }}>Load More</View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export {};
