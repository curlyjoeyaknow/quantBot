#!/usr/bin/env ts-node
/**
 * Check Token Address Lengths in Database
 *
 * Verifies that all Solana token addresses are full length (32-44 characters)
 */

import 'dotenv/config';
import { getPostgresPool } from '@quantbot/storage';

async function main() {
  try {
    const pool = getPostgresPool();

    // Check address lengths in tokens table
    const result = await pool.query<{
      id: number;
      address: string;
      addr_length: number;
      chain: string;
      symbol: string | null;
    }>(`
      SELECT 
        id,
        address,
        LENGTH(address) as addr_length,
        chain,
        symbol
      FROM tokens
      WHERE chain = 'solana'
      ORDER BY LENGTH(address) ASC
      LIMIT 20
    `);

    console.log('\n=== Token Address Length Analysis ===');
    console.log('\nShortest addresses:');
    result.rows.forEach(
      (row: {
        id: number;
        address: string;
        addr_length: number;
        chain: string;
        symbol: string | null;
      }) => {
        const status =
          row.addr_length < 32 ? '❌ TOO SHORT' : row.addr_length > 44 ? '❌ TOO LONG' : '✅ OK';
        console.log(
          `  ${status} | ID: ${row.id} | Length: ${row.addr_length} | Address: ${row.address} | Symbol: ${row.symbol || 'N/A'}`
        );
      }
    );

    // Get statistics
    const stats = await pool.query<{
      total: number;
      too_short: number;
      valid: number;
      too_long: number;
      min_length: number;
      max_length: number;
      avg_length: number;
    }>(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN LENGTH(address) < 32 THEN 1 END) as too_short,
        COUNT(CASE WHEN LENGTH(address) >= 32 AND LENGTH(address) <= 44 THEN 1 END) as valid,
        COUNT(CASE WHEN LENGTH(address) > 44 THEN 1 END) as too_long,
        MIN(LENGTH(address)) as min_length,
        MAX(LENGTH(address)) as max_length,
        AVG(LENGTH(address))::INTEGER as avg_length
      FROM tokens
      WHERE chain = 'solana'
    `);

    console.log('\n=== Statistics ===');
    const s = stats.rows[0];
    console.log(`Total Solana tokens: ${s.total}`);
    console.log(`✅ Valid length (32-44): ${s.valid}`);
    console.log(`❌ Too short (<32): ${s.too_short}`);
    console.log(`❌ Too long (>44): ${s.too_long}`);
    console.log(`Min length: ${s.min_length}`);
    console.log(`Max length: ${s.max_length}`);
    console.log(`Avg length: ${s.avg_length}`);

    // Check addresses that are too short
    if (s.too_short > 0) {
      const shortAddrs = await pool.query<{
        id: number;
        address: string;
        addr_length: number;
        symbol: string | null;
      }>(`
        SELECT id, address, LENGTH(address) as addr_length, symbol
        FROM tokens
        WHERE chain = 'solana' AND LENGTH(address) < 32
        LIMIT 10
      `);
      console.log('\n=== Truncated Addresses (First 10) ===');
      shortAddrs.rows.forEach(
        (row: { id: number; address: string; addr_length: number; symbol: string | null }) => {
          console.log(
            `  ID: ${row.id} | Length: ${row.addr_length} | Address: ${row.address} | Symbol: ${row.symbol || 'N/A'}`
          );
        }
      );
    }

    // Check addresses that are exactly 20 characters (common truncation point)
    const exactly20 = await pool.query<{
      id: number;
      address: string;
      symbol: string | null;
    }>(`
      SELECT id, address, symbol
      FROM tokens
      WHERE chain = 'solana' AND LENGTH(address) = 20
      LIMIT 5
    `);

    if (exactly20.rows.length > 0) {
      console.log('\n=== Addresses Exactly 20 Characters (Likely Truncated) ===');
      exactly20.rows.forEach((row: { id: number; address: string; symbol: string | null }) => {
        console.log(`  ID: ${row.id} | Address: ${row.address} | Symbol: ${row.symbol || 'N/A'}`);
      });
    }

    process.exit(0);
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
