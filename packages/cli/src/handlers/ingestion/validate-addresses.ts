/**
 * Handler for validate-addresses command
 *
 * Validates addresses and fetches metadata across chains
 */

import type { CommandContext } from '../../core/command-context.js';
import { isEvmAddress, isSolanaAddress } from '@quantbot/utils';
import { fetchMultiChainMetadata } from '@quantbot/api-clients';
import type { Chain } from '@quantbot/core';

export type ValidateAddressesArgs = {
  addresses: string[];
  chainHint?: string;
};

export async function validateAddressesHandler(args: ValidateAddressesArgs, _ctx: CommandContext) {
  const results = [];

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
