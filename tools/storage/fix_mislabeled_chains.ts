#!/usr/bin/env tsx
/**
 * Fix Mislabeled Chains
 * 
 * Finds tokens labeled as "solana" that are not actually base58 Solana addresses,
 * uses Birdeye API to find the correct chain, and updates ClickHouse.
 */

import { getClickHouseClient, logger } from '@quantbot/infra';
import { isSolanaAddress } from '@quantbot/utils';
import { config } from 'dotenv';

config();

interface TokenRecord {
  token_address: string;
  chain: string;
  count: number;
}

interface ChainResolution {
  address: string;
  originalChain: string;
  resolvedChain: string | null;
  success: boolean;
  error?: string;
}

/**
 * Search for token across all chains using Birdeye API
 */
async function searchTokenAcrossChains(
  address: string
): Promise<{ chain: string | null; network?: string }> {
  try {
    // Use the search endpoint with chain=all
    // We'll need to make a direct API call since searchToken doesn't support 'all'
    const axios = (await import('axios')).default;
    const apiKey = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEYS?.split(',')[0];
    
    if (!apiKey) {
      throw new Error('BIRDEYE_API_KEY not found in environment');
    }

    const response = await axios.get('https://public-api.birdeye.so/defi/v3/search', {
      params: {
        chain: 'all',
        keyword: address,
        target: 'token',
        search_mode: 'exact',
        search_by: 'address',
        sort_by: 'volume_24h_usd',
        sort_type: 'desc',
        offset: 0,
        limit: 20,
        ui_amount_mode: 'scaled',
      },
      headers: {
        'X-API-KEY': apiKey,
        'accept': 'application/json',
      },
      timeout: 10000,
    });

    if (response.data?.success && response.data?.data?.items) {
      const tokenItem = response.data.data.items.find((item: { type: string }) => item.type === 'token');
      if (tokenItem?.result && tokenItem.result.length > 0) {
        const token = tokenItem.result[0];
        // Normalize chain name
        const network = token.network?.toLowerCase();
        if (network) {
          // Map Birdeye network names to our chain names
          const chainMap: Record<string, string> = {
            'solana': 'solana',
            'ethereum': 'ethereum',
            'bsc': 'bsc',
            'binance': 'bsc',
            'base': 'base',
          };
          return {
            chain: chainMap[network] || network,
            network: token.network,
          };
        }
      }
    }

    return { chain: null };
  } catch (error) {
    logger.warn('Failed to search token across chains', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return { chain: null };
  }
}

/**
 * Get all tokens labeled as "solana" from ClickHouse
 */
async function getSolanaLabeledTokens(): Promise<TokenRecord[]> {
  const client = getClickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Get unique tokens from both ohlcv and token_metadata tables
  const query = `
    SELECT 
      token_address,
      chain,
      count(*) as count
    FROM (
      SELECT DISTINCT token_address, chain
      FROM ${database}.ohlcv
      WHERE chain = 'solana'
      
      UNION ALL
      
      SELECT DISTINCT token_address, chain
      FROM ${database}.token_metadata
      WHERE chain = 'solana'
    )
    GROUP BY token_address, chain
    ORDER BY count DESC
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as TokenRecord[];
  return rows;
}

/**
 * Update chain in ClickHouse tables
 */
async function updateChainInClickHouse(
  address: string,
  oldChain: string,
  newChain: string
): Promise<{ ohlcvUpdated: number; metadataUpdated: number }> {
  const client = getClickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const escapedAddress = address.replace(/'/g, "''");
  const escapedOldChain = oldChain.replace(/'/g, "''");
  const escapedNewChain = newChain.replace(/'/g, "''");

  let ohlcvUpdated = 0;
  let metadataUpdated = 0;

  try {
    // Update ohlcv table
    const ohlcvQuery = `
      ALTER TABLE ${database}.ohlcv
      UPDATE chain = '${escapedNewChain}'
      WHERE token_address = '${escapedAddress}' AND chain = '${escapedOldChain}'
    `;
    
    await client.exec({
      query: ohlcvQuery,
    });
    
    // Get count of updated rows (approximate)
    const ohlcvCountQuery = `
      SELECT count(*) as count
      FROM ${database}.ohlcv
      WHERE token_address = '${escapedAddress}' AND chain = '${escapedNewChain}'
    `;
    const ohlcvCountResult = await client.query({
      query: ohlcvCountQuery,
      format: 'JSONEachRow',
    });
    const ohlcvCountRows = (await ohlcvCountResult.json()) as Array<{ count: string }>;
    ohlcvUpdated = parseInt(ohlcvCountRows[0]?.count || '0', 10);
  } catch (error) {
    logger.warn('Failed to update ohlcv table (ClickHouse may not support ALTER TABLE UPDATE)', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    // Update token_metadata table
    const metadataQuery = `
      ALTER TABLE ${database}.token_metadata
      UPDATE chain = '${escapedNewChain}'
      WHERE token_address = '${escapedAddress}' AND chain = '${escapedOldChain}'
    `;
    
    await client.exec({
      query: metadataQuery,
    });
    
    // Get count of updated rows (approximate)
    const metadataCountQuery = `
      SELECT count(*) as count
      FROM ${database}.token_metadata
      WHERE token_address = '${escapedAddress}' AND chain = '${escapedNewChain}'
    `;
    const metadataCountResult = await client.query({
      query: metadataCountQuery,
      format: 'JSONEachRow',
    });
    const metadataCountRows = (await metadataCountResult.json()) as Array<{ count: string }>;
    metadataUpdated = parseInt(metadataCountRows[0]?.count || '0', 10);
  } catch (error) {
    logger.warn('Failed to update token_metadata table (ClickHouse may not support ALTER TABLE UPDATE)', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ohlcvUpdated, metadataUpdated };
}

/**
 * Main function
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limit = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '100', 10)
    : undefined;

  logger.info('Starting chain correction process', { dryRun, limit });

  // Get all tokens labeled as "solana"
  logger.info('Fetching tokens labeled as "solana" from ClickHouse...');
  const tokens = await getSolanaLabeledTokens();
  logger.info(`Found ${tokens.length} unique tokens labeled as "solana"`);

  if (limit) {
    tokens.splice(limit);
    logger.info(`Limited to first ${limit} tokens`);
  }

  const resolutions: ChainResolution[] = [];
  let processed = 0;
  let needsCorrection = 0;
  let corrected = 0;
  let errors = 0;

  for (const token of tokens) {
    processed++;
    const address = token.token_address;

    // Check if address is actually a valid Solana address
    if (isSolanaAddress(address)) {
      // Valid Solana address, skip
      continue;
    }

    needsCorrection++;
    logger.info(`[${processed}/${tokens.length}] Checking ${address.substring(0, 20)}... (not base58)`);

    // Search for token across all chains
    const { chain: resolvedChain, network } = await searchTokenAcrossChains(address);

    if (resolvedChain && resolvedChain !== 'solana') {
      logger.info(`  → Found on chain: ${resolvedChain} (network: ${network})`);
      
      resolutions.push({
        address,
        originalChain: 'solana',
        resolvedChain,
        success: true,
      });

      if (!dryRun) {
        try {
          const { ohlcvUpdated, metadataUpdated } = await updateChainInClickHouse(
            address,
            'solana',
            resolvedChain
          );
          logger.info(`  ✓ Updated: ${ohlcvUpdated} ohlcv rows, ${metadataUpdated} metadata rows`);
          corrected++;
        } catch (error) {
          logger.error(`  ✗ Failed to update: ${error instanceof Error ? error.message : String(error)}`);
          errors++;
          resolutions[resolutions.length - 1].success = false;
          resolutions[resolutions.length - 1].error = error instanceof Error ? error.message : String(error);
        }
      } else {
        logger.info(`  [DRY RUN] Would update to chain: ${resolvedChain}`);
        corrected++;
      }
    } else {
      logger.warn(`  → Could not resolve chain for ${address}`);
      resolutions.push({
        address,
        originalChain: 'solana',
        resolvedChain: null,
        success: false,
        error: 'Token not found in Birdeye or already on correct chain',
      });
      errors++;
    }

    // Rate limiting - wait 100ms between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Total tokens processed: ${processed}`);
  logger.info(`Tokens needing correction: ${needsCorrection}`);
  logger.info(`Successfully corrected: ${corrected}`);
  logger.info(`Errors: ${errors}`);
  logger.info(`Valid Solana addresses (skipped): ${processed - needsCorrection}`);

  // Write results to file
  const resultsFile = `chain_corrections_${Date.now()}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(
    resultsFile,
    JSON.stringify(resolutions, null, 2)
  );
  logger.info(`\nResults written to: ${resultsFile}`);
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});

