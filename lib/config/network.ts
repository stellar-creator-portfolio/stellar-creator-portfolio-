/**
 * Network configuration — Issue #521
 *
 * All Soroban RPC URIs and network passphrases are driven by environment
 * variables. No hardcoded values. Flip NEXT_PUBLIC_STELLAR_NETWORK to
 * "mainnet" for production; anything else defaults to testnet.
 */

export type NetworkName = "mainnet" | "testnet";

export interface NetworkConfig {
  network: NetworkName;
  rpcUrl: string;
  passphrase: string;
  isTestnet: boolean;
}

const CONFIGS: Record<NetworkName, { rpcUrl: string; passphrase: string }> = {
  mainnet: {
    rpcUrl:
      process.env.NEXT_PUBLIC_MAINNET_RPC_URL ??
      "https://soroban-mainnet.stellar.org",
    passphrase:
      process.env.NEXT_PUBLIC_MAINNET_PASSPHRASE ??
      "Public Global Stellar Network ; September 2015",
  },
  testnet: {
    rpcUrl:
      process.env.NEXT_PUBLIC_TESTNET_RPC_URL ??
      "https://soroban-testnet.stellar.org",
    passphrase:
      process.env.NEXT_PUBLIC_TESTNET_PASSPHRASE ??
      "Test SDF Network ; September 2015",
  },
};

/** Returns the active network config derived from env vars. */
export function getNetworkConfig(): NetworkConfig {
  const raw = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
  const network: NetworkName = raw === "mainnet" ? "mainnet" : "testnet";
  return {
    network,
    isTestnet: network === "testnet",
    ...CONFIGS[network],
  };
}

/** True when the app is running against testnet — use for UX banners. */
export const IS_TESTNET =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet") !== "mainnet";
