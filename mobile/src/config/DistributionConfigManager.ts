/**
 * Distribution Configuration Manager
 * Manages and provides access to distribution configurations
 */

import {
  DistributionConfig,
  ReleaseChannel,
  Platform,
  getDistributionConfig,
  getCurrentReleaseChannel,
  validateDistributionConfig,
} from './distributionMappings';

export class DistributionConfigManager {
  private static instance: DistributionConfigManager;
  private config: DistributionConfig | null = null;
  private platform: Platform;
  private channel: ReleaseChannel;

  private constructor(platform: Platform, channel: ReleaseChannel) {
    this.platform = platform;
    this.channel = channel;
    this.initializeConfig();
  }

  /**
   * Initialize singleton instance
   */
  public static initialize(platform: Platform, channel?: ReleaseChannel): DistributionConfigManager {
    const releaseChannel = channel || getCurrentReleaseChannel();
    if (!DistributionConfigManager.instance) {
      DistributionConfigManager.instance = new DistributionConfigManager(
        platform,
        releaseChannel,
      );
    }
    return DistributionConfigManager.instance;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DistributionConfigManager {
    if (!DistributionConfigManager.instance) {
      throw new Error(
        'DistributionConfigManager not initialized. Call initialize() first.',
      );
    }
    return DistributionConfigManager.instance;
  }

  /**
   * Initialize configuration
   */
  private initializeConfig(): void {
    try {
      this.config = getDistributionConfig(this.channel, this.platform);
      if (!validateDistributionConfig(this.config)) {
        console.warn('Distribution configuration validation failed');
      }
    } catch (error) {
      console.error('Failed to initialize distribution configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): DistributionConfig {
    if (!this.config) {
      throw new Error('Distribution configuration not initialized');
    }
    return this.config;
  }

  /**
   * Get API endpoint
   */
  public getApiEndpoint(): string {
    return this.getConfig().apiEndpoint;
  }

  /**
   * Get Sentry DSN
   */
  public getSentryDsn(): string | undefined {
    return this.getConfig().sentryDsn;
  }

  /**
   * Get release channel
   */
  public getReleaseChannel(): ReleaseChannel {
    return this.channel;
  }

  /**
   * Get platform
   */
  public getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Check if debug is enabled
   */
  public isDebugEnabled(): boolean {
    return this.getConfig().enableDebug;
  }

  /**
   * Check if analytics is enabled
   */
  public isAnalyticsEnabled(): boolean {
    return this.getConfig().enableAnalytics;
  }

  /**
   * Get max retries
   */
  public getMaxRetries(): number {
    return this.getConfig().maxRetries;
  }

  /**
   * Get timeout in milliseconds
   */
  public getTimeoutMs(): number {
    return this.getConfig().timeoutMs;
  }
}
