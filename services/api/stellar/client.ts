import { rpc, Networks } from '@stellar/stellar-sdk';
import { getSecret } from '@/backend/services/kms';
import type { StellarConfig } from './types';

const defaultRpcUrl = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const defaultNetworkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const defaultContractId = process.env.CONTRACT_ID ?? '';

export class StellarClient {
  private static instance: StellarClient;
  public rpc: rpc.Server;
  public config: StellarConfig;

  private constructor(config: StellarConfig) {
    this.config = config;
    this.rpc = new rpc.Server(this.config.rpcUrl);
  }

  /**
   * Async factory — resolves the admin secret via KMS before constructing
   * the singleton so the secret value is never stored in plain env vars in
   * production.
   */
  public static async getInstance(config?: Partial<Omit<StellarConfig, 'adminSecret'>>): Promise<StellarClient> {
    if (StellarClient.instance) return StellarClient.instance;

    const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');

    StellarClient.instance = new StellarClient({
      rpcUrl: config?.rpcUrl ?? defaultRpcUrl,
      networkPassphrase: config?.networkPassphrase ?? defaultNetworkPassphrase,
      contractId: config?.contractId ?? defaultContractId,
      adminSecret,
    });

    return StellarClient.instance;
  }
}
