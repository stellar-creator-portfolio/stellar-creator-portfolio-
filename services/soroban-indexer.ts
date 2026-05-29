/**
 * Soroban Indexer Service — Contract Simulation Pre-flight (#518)
 *
 * Provides RPC simulation endpoints that validate transactions before
 * wallet confirmation, parsing gas estimates and surfacing failures early.
 */

import { getNetworkConfig } from "@/lib/config/network";
import { rpcCall, startProbing } from "@/lib/config/rpc-fallback";

export interface SimulateParams {
  contractId: string;
  method: string;
  args: unknown[];
  sourceAccount: string;
}

export interface SimulationResult {
  success: boolean;
  gasEstimate?: number;
  error?: string;
  rawResult?: unknown;
}

/**
 * Simulate a Soroban contract invocation against the configured RPC endpoint.
 * Returns gas estimate on success or a structured error before wallet prompt.
 */
export async function simulateContractCall(
  params: SimulateParams
): Promise<SimulationResult> {
  const { network } = getNetworkConfig();
  startProbing(network);

  let result: { result?: { cost?: { cpuInsns?: string }; error?: string } };
  try {
    const rpcResult = await rpcCall<{ cost?: { cpuInsns?: string }; error?: string }>(
      network,
      "simulateTransaction",
      { transaction: buildTransactionEnvelope(params) },
    );
    result = { result: rpcResult.data };
  } catch (err) {
    return {
      success: false,
      error: `RPC connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const res = result.result;
  if (!res) return { success: false, error: "Empty simulation result" };
  if (res.error) return { success: false, error: res.error };

  const gasEstimate = res.cost?.cpuInsns
    ? parseInt(res.cost.cpuInsns, 10)
    : undefined;

  return { success: true, gasEstimate, rawResult: res };
}

/**
 * Minimal XDR-like envelope builder (placeholder for actual Stellar SDK usage).
 * In production, replace with StellarSdk.TransactionBuilder output.
 */
function buildTransactionEnvelope(params: SimulateParams): string {
  // Encode params as base64 JSON stub; real impl uses stellar-sdk XDR encoding.
  const payload = {
    contractId: params.contractId,
    method: params.method,
    args: params.args,
    source: params.sourceAccount,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
