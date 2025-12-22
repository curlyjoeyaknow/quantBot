/**
 * Pure Handler for validate-addresses command
 *
 * This is a pure use-case function:
 * - No Commander.js
 * - No console.log / console.error
 * - No process.exit
 * - No environment variable reads
 * - No output formatting
 * - Pure orchestration: get service from context, call service method, return result
 */

import type { CommandContext } from '../../core/command-context.js';
import { isEvmAddress, isSolanaAddress } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';

export type ValidateAddressesArgs = {
  addresses: string[];
  chainHint?: string;
};

export type ValidateAddressesResult = {
  results: Array<{
    address: string;
    addressKind: 'evm' | 'solana' | 'unknown';
    valid?: boolean;
    found?: boolean;
    chainHint?: Chain;
    chain?: Chain;
    name?: string;
    symbol?: string;
    chainsAttempted?: Array<{
      chain: Chain;
      found: boolean;
    }>;
    error?: string;
  }>;
  summary: {
    total: number;
    valid: number;
    found: number;
    evm: number;
    solana: number;
  };
};

/**
 * Pure handler for address validation
 *
 * Uses MarketDataPort for fetching metadata (when adapters are wired).
 * For now, falls back to direct API client call for backward compatibility.
 */
export async function validateAddressesHandler(
  args: ValidateAddressesArgs,
  _ctx: CommandContext
): Promise<ValidateAddressesResult> {
  const results: ValidateAddressesResult['results'] = [];

  // Get market data port from context (when adapters are wired)
  // For now, we'll use the API client directly as a temporary measure
  // TODO: Wire MarketDataPort adapter in command composition root
  const { fetchMultiChainMetadata } = await import('@quantbot/api-clients');

  for (const address of args.addresses) {
    const addressKind = isEvmAddress(address)
      ? 'evm'
      : isSolanaAddress(address)
        ? 'solana'
        : 'unknown';

    if (addressKind === 'unknown') {
      results.push({
        address,
        addressKind: 'unknown',
        valid: false,
        error: 'Invalid address format',
      });
      continue;
    }

    try {
      const chainHint: Chain | undefined = args.chainHint as Chain | undefined;
      const result = await fetchMultiChainMetadata(address, chainHint);

      results.push({
        address,
        addressKind: result.addressKind,
        chainHint: result.chainHint,
        found: !!result.primaryMetadata,
        chain: result.primaryMetadata?.chain,
        name: result.primaryMetadata?.name,
        symbol: result.primaryMetadata?.symbol,
        chainsAttempted: result.metadata.map((m) => ({
          chain: m.chain,
          found: m.found,
        })),
      });
    } catch (error) {
      results.push({
        address,
        addressKind,
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    results,
    summary: {
      total: results.length,
      valid: results.filter((r) => r.valid !== false).length,
      found: results.filter((r) => r.found === true).length,
      evm: results.filter((r) => r.addressKind === 'evm').length,
      solana: results.filter((r) => r.addressKind === 'solana').length,
    },
  };
}
