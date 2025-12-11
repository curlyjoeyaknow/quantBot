#!/usr/bin/env tsx
"use strict";
/**
 * Fetch and update token metadata from Birdeye
 * - Fetches name, symbol, decimals, logo, socials, market cap
 * - Updates PostgreSQL tokens table
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';
const pgPool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || 'quantbot',
    database: process.env.POSTGRES_DB || 'quantbot',
});
async function fetchBirdeyeMetadata(tokenAddress, chain) {
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
                'X-API-KEY': BIRDEYE_API_KEY,
                'x-chain': birdeyeChain,
                'Accept': 'application/json',
            },
        });
        if (metaResponse.ok) {
            const metaData = await metaResponse.json();
            if (metaData.success && metaData.data && metaData.data.symbol) {
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
                'X-API-KEY': BIRDEYE_API_KEY,
                'x-chain': birdeyeChain,
            },
        });
        if (overviewResponse.ok) {
            const overviewData = await overviewResponse.json();
            if (overviewData.success && overviewData.data && overviewData.data.symbol) {
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
    }
    catch (error) {
        // Silently fail - many tokens won't exist
        return null;
    }
}
async function updateTokenMetadata(tokenId, metadata) {
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
    await pgPool.query(`UPDATE tokens 
     SET symbol = $1, name = $2, decimals = $3, metadata_json = $4, updated_at = NOW()
     WHERE id = $5`, [metadata.symbol, metadata.name, metadata.decimals, JSON.stringify(metadataJson), tokenId]);
}
async function main() {
    if (!BIRDEYE_API_KEY) {
        console.error('❌ BIRDEYE_API_KEY not set');
        process.exit(1);
    }
    console.log('🔄 Fetching token metadata...\n');
    // Get tokens WITH alerts that need metadata
    // Filter out invalid addresses (x-prefix is likely corrupted data)
    const result = await pgPool.query(`
    SELECT 
      t.id, 
      t.address, 
      t.chain, 
      t.symbol, 
      t.name, 
      t.metadata_json,
      COUNT(a.id) as alert_count
    FROM tokens t
    LEFT JOIN alerts a ON a.token_id = t.id AND a.alert_price IS NOT NULL
    WHERE (
      t.symbol IS NULL 
      OR t.symbol = 'UNKNOWN' 
      OR t.name IS NULL 
      OR t.metadata_json IS NULL
      OR t.metadata_json->>'fetchedAt' IS NULL
    )
    AND (
      -- Valid Solana addresses (base58, 32-44 chars)
      (t.chain = 'solana' AND t.address NOT LIKE '0x%' AND t.address NOT LIKE 'x%' AND LENGTH(t.address) BETWEEN 32 AND 44)
      OR
      -- Valid EVM addresses (0x + 40 hex chars)
      (t.chain != 'solana' AND t.address LIKE '0x%' AND LENGTH(t.address) = 42)
    )
    GROUP BY t.id, t.address, t.chain, t.symbol, t.name, t.metadata_json
    ORDER BY COUNT(a.id) DESC, t.created_at DESC
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
        }
        else {
            // Mark as attempted even if failed
            await pgPool.query(`UPDATE tokens SET metadata_json = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify({ fetchedAt: new Date().toISOString(), error: 'Not found' }), token.id]);
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
//# sourceMappingURL=fetch-token-metadata.js.map