#!/usr/bin/env tsx
/**
 * Fetch and update token metadata from Birdeye
 * - Fetches name, symbol, decimals, logo, socials, market cap
 * - Updates PostgreSQL tokens table
 */

import 'dotenv/config';
import { Pool } from 'pg';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || 'quantbot',
  database: process.env.POSTGRES_DB || 'quantbot',
});

interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  description?: string;
  mc?: number;
  v24hUSD?: number;
  v24hChangePercent?: number;
  price?: number;
}

async function fetchBirdeyeMetadata(tokenAddress: string, chain: string): Promise<TokenMetadata | null> {
  try {
    // Map chain to Birdeye format
    const birdeyeChain = chain === 'solana' ? 'solana' : 
                        chain === 'bsc' ? 'bsc' :
                        chain === 'ethereum' ? 'eth' :
                        chain === 'base' ? 'base' :
                        chain === 'arbitrum' ? 'arbitrum' :
                        'solana'; // default
    
    // Try token metadata endpoint first
    const metaUrl = `${BIRDEYE_BASE_URL}/defi/v3/token/meta-data/single?address=${tokenAddress}`;
    const metaResponse = await fetch(metaUrl, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY!,
        'x-chain': birdeyeChain,
      },
    });

    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      if (metaData.success && metaData.data) {
        const d = metaData.data;
        return {
          address: tokenAddress,
          symbol: d.symbol || 'UNKNOWN',
          name: d.name || d.symbol || 'Unknown Token',
          decimals: d.decimals || 9,
          logoURI: d.logo_uri || d.logoURI,
          twitter: d.extensions?.twitter || d.twitter,
          telegram: d.extensions?.telegram || d.telegram,
          discord: d.extensions?.discord || d.discord,
          website: d.extensions?.website || d.website,
          description: d.extensions?.description || d.description,
        };
      }
    }

    // Fallback to token overview endpoint
    const overviewUrl = `${BIRDEYE_BASE_URL}/defi/token_overview?address=${tokenAddress}`;
    const overviewResponse = await fetch(overviewUrl, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY!,
        'x-chain': birdeyeChain,
      },
    });

    if (overviewResponse.ok) {
      const overviewData = await overviewResponse.json();
      if (overviewData.success && overviewData.data) {
        const d = overviewData.data;
        return {
          address: tokenAddress,
          symbol: d.symbol || 'UNKNOWN',
          name: d.name || d.symbol || 'Unknown Token',
          decimals: d.decimals || 9,
          logoURI: d.logoURI,
          mc: d.mc,
          v24hUSD: d.v24hUSD,
          v24hChangePercent: d.v24hChangePercent,
          price: d.price,
          twitter: d.extensions?.twitter,
          telegram: d.extensions?.telegram,
          website: d.extensions?.website,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching metadata for ${tokenAddress}:`, error);
    return null;
  }
}

async function updateTokenMetadata(
  tokenId: number,
  metadata: TokenMetadata
): Promise<void> {
  const metadataJson = {
    logoURI: metadata.logoURI,
    twitter: metadata.twitter,
    telegram: metadata.telegram,
    discord: metadata.discord,
    website: metadata.website,
    description: metadata.description,
    mc: metadata.mc,
    v24hUSD: metadata.v24hUSD,
    v24hChangePercent: metadata.v24hChangePercent,
    price: metadata.price,
    coingeckoId: metadata.coingeckoId,
    fetchedAt: new Date().toISOString(),
  };

  await pgPool.query(
    `UPDATE tokens 
     SET symbol = $1, name = $2, decimals = $3, metadata_json = $4, updated_at = NOW()
     WHERE id = $5`,
    [metadata.symbol, metadata.name, metadata.decimals, JSON.stringify(metadataJson), tokenId]
  );
}

async function main() {
  if (!BIRDEYE_API_KEY) {
    console.error('❌ BIRDEYE_API_KEY not set');
    process.exit(1);
  }

  console.log('🔄 Fetching token metadata...\n');

  // Get ALL tokens that need metadata (both Solana and EVM)
  const result = await pgPool.query(`
    SELECT id, address, chain, symbol, name, metadata_json
    FROM tokens
    WHERE (
      symbol IS NULL 
      OR symbol = 'UNKNOWN' 
      OR name IS NULL 
      OR metadata_json IS NULL
      OR metadata_json->>'fetchedAt' IS NULL
    )
    ORDER BY created_at DESC
    LIMIT 500
  `);

  console.log(`📊 Found ${result.rows.length} tokens needing metadata\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < result.rows.length; i++) {
    const token = result.rows[i];
    
    process.stdout.write(`[${i + 1}/${result.rows.length}] ${token.address.substring(0, 20)}... `);

    const metadata = await fetchBirdeyeMetadata(token.address, token.chain);

    if (metadata) {
      await updateTokenMetadata(token.id, metadata);
      console.log(`✅ ${metadata.symbol} (${metadata.name})`);
      updated++;
    } else {
      // Mark as attempted even if failed
      await pgPool.query(
        `UPDATE tokens SET metadata_json = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ fetchedAt: new Date().toISOString(), error: 'Not found' }), token.id]
      );
      console.log(`⚠️ Not found`);
      failed++;
    }

    // Rate limit: 50ms between requests
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   ✅ Updated: ${updated} tokens`);
  console.log(`   ⚠️ Not found: ${failed} tokens`);

  // Show sample of updated tokens
  const sample = await pgPool.query(`
    SELECT symbol, name, decimals, 
           metadata_json->>'logoURI' as logo,
           metadata_json->>'twitter' as twitter,
           metadata_json->>'mc' as market_cap
    FROM tokens
    WHERE chain = 'solana' 
    AND symbol != 'UNKNOWN'
    AND metadata_json->>'fetchedAt' IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 10
  `);

  console.log('\n📋 Sample of updated tokens:');
  console.table(sample.rows);

  await pgPool.end();
}

main().catch(console.error);

