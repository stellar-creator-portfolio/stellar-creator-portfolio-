/**
 * Production Distribution Mappings
 * Environment-specific configurations for production release distribution
 */

export enum ReleaseChannel {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  BETA = 'beta',
}

export enum Platform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

export interface DistributionConfig {
  channel: ReleaseChannel;
  platform: Platform;
  bundleId: string;
  packageName: string;
  apiEndpoint: string;
  sentryDsn?: string;
  maxRetries: number;
  timeoutMs: number;
  enableDebug: boolean;
  enableAnalytics: boolean;
}

const productionConfigs: Record<ReleaseChannel, Record<Platform, DistributionConfig>> = {
  [ReleaseChannel.DEVELOPMENT]: {
    [Platform.IOS]: {
      channel: ReleaseChannel.DEVELOPMENT,
      platform: Platform.IOS,
      bundleId: 'com.stellar.creatorportfolio.dev',
      packageName: 'com.stellar.creatorportfolio.dev',
      apiEndpoint: 'http://localhost:3000/api',
      sentryDsn: undefined,
      maxRetries: 3,
      timeoutMs: 30000,
      enableDebug: true,
      enableAnalytics: false,
    },
    [Platform.ANDROID]: {
      channel: ReleaseChannel.DEVELOPMENT,
      platform: Platform.ANDROID,
      bundleId: 'com.stellar.creatorportfolio.dev',
      packageName: 'com.stellar.creatorportfolio.dev',
      apiEndpoint: 'http://localhost:3000/api',
      sentryDsn: undefined,
      maxRetries: 3,
      timeoutMs: 30000,
      enableDebug: true,
      enableAnalytics: false,
    },
  },
  [ReleaseChannel.STAGING]: {
    [Platform.IOS]: {
      channel: ReleaseChannel.STAGING,
      platform: Platform.IOS,
      bundleId: 'com.stellar.creatorportfolio.staging',
      packageName: 'com.stellar.creatorportfolio.staging',
      apiEndpoint: 'https://api-staging.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_STAGING,
      maxRetries: 2,
      timeoutMs: 20000,
      enableDebug: true,
      enableAnalytics: true,
    },
    [Platform.ANDROID]: {
      channel: ReleaseChannel.STAGING,
      platform: Platform.ANDROID,
      bundleId: 'com.stellar.creatorportfolio.staging',
      packageName: 'com.stellar.creatorportfolio.staging',
      apiEndpoint: 'https://api-staging.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_STAGING,
      maxRetries: 2,
      timeoutMs: 20000,
      enableDebug: true,
      enableAnalytics: true,
    },
  },
  [ReleaseChannel.BETA]: {
    [Platform.IOS]: {
      channel: ReleaseChannel.BETA,
      platform: Platform.IOS,
      bundleId: 'com.stellar.creatorportfolio.beta',
      packageName: 'com.stellar.creatorportfolio.beta',
      apiEndpoint: 'https://api-beta.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_BETA,
      maxRetries: 2,
      timeoutMs: 15000,
      enableDebug: false,
      enableAnalytics: true,
    },
    [Platform.ANDROID]: {
      channel: ReleaseChannel.BETA,
      platform: Platform.ANDROID,
      bundleId: 'com.stellar.creatorportfolio.beta',
      packageName: 'com.stellar.creatorportfolio.beta',
      apiEndpoint: 'https://api-beta.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_BETA,
      maxRetries: 2,
      timeoutMs: 15000,
      enableDebug: false,
      enableAnalytics: true,
    },
  },
  [ReleaseChannel.PRODUCTION]: {
    [Platform.IOS]: {
      channel: ReleaseChannel.PRODUCTION,
      platform: Platform.IOS,
      bundleId: 'com.stellar.creatorportfolio',
      packageName: 'com.stellar.creatorportfolio',
      apiEndpoint: 'https://api.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_PRODUCTION,
      maxRetries: 1,
      timeoutMs: 10000,
      enableDebug: false,
      enableAnalytics: true,
    },
    [Platform.ANDROID]: {
      channel: ReleaseChannel.PRODUCTION,
      platform: Platform.ANDROID,
      bundleId: 'com.stellar.creatorportfolio',
      packageName: 'com.stellar.creatorportfolio',
      apiEndpoint: 'https://api.stellar.com/api',
      sentryDsn: process.env.SENTRY_DSN_PRODUCTION,
      maxRetries: 1,
      timeoutMs: 10000,
      enableDebug: false,
      enableAnalytics: true,
    },
  },
};

/**
 * Get distribution configuration for the current environment and platform
 */
export const getDistributionConfig = (
  channel: ReleaseChannel,
  platform: Platform,
): DistributionConfig => {
  const config = productionConfigs[channel]?.[platform];
  if (!config) {
    throw new Error(
      `Distribution config not found for channel: ${channel}, platform: ${platform}`,
    );
  }
  return config;
};

/**
 * Get current platform
 */
export const getCurrentPlatform = (): Platform => {
  // This will be determined at runtime
  return Platform.IOS; // Placeholder - will be set based on actual platform
};

/**
 * Get current release channel from environment
 */
export const getCurrentReleaseChannel = (): ReleaseChannel => {
  const channel = process.env.RELEASE_CHANNEL || ReleaseChannel.DEVELOPMENT;
  return channel as ReleaseChannel;
};

/**
 * Validate distribution configuration
 */
export const validateDistributionConfig = (config: DistributionConfig): boolean => {
  if (!config.channel || !config.platform) {
    return false;
  }
  if (!config.apiEndpoint || config.apiEndpoint.length === 0) {
    return false;
  }
  if (config.maxRetries < 0 || config.timeoutMs < 1000) {
    return false;
  }
  return true;
};
