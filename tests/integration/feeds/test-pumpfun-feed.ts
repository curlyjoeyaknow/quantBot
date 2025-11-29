#!/usr/bin/env ts-node
/**
 * Test Pump.fun Real-Time Feed
 * Shows actual Pump.fun bonding curve updates
 */

import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';

// Pump.fun program ID
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Derive bonding curve PDA
function deriveBondingCurve(mint: string): string {
  const mintPubkey = new PublicKey(mint);
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return bondingCurve.toBase58();
}

// Parse price from bonding curve data (simplified)
function parsePrice(data: Buffer | Uint8Array): { solReserve: number; tokenReserve: number; price?: number } {
  if (!data || data.length < 16) return { solReserve: 0, tokenReserve: 0 };
  
  // Bonding curve structure (simplified - actual structure is more complex):
  // First 8 bytes: SOL reserve (u64)
  // Next 8 bytes: Token reserve (u64)
  try {
    const solReserve = Number(data.readBigUInt64LE(0));
    const tokenReserve = Number(data.readBigUInt64LE(8));
    const price = tokenReserve > 0 ? solReserve / tokenReserve : 0;
    
    return { solReserve, tokenReserve, price };
  } catch (e) {
    return { solReserve: 0, tokenReserve: 0 };
  }
}

async function testPumpfunFeed() {
  console.log('🔌 Connecting to Yellowstone gRPC for Pump.fun feed...\n');
  
  const yellowstone = require('@triton-one/yellowstone-grpc');
  const Client = yellowstone.default;
  const CommitmentLevel = yellowstone.CommitmentLevel;
  
  const client = new Client(
    process.env.SHYFT_GRPC_URL || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_X_TOKEN
  );

  // Example Pump.fun token mint (replace with a real one)
  // You can get recent Pump.fun tokens from: https://pump.fun
  const TEST_MINT = process.argv[2] || 'So11111111111111111111111111111111111111112'; // Default to SOL for testing
  
  let bondingCurveAddress: string;
  try {
    bondingCurveAddress = deriveBondingCurve(TEST_MINT);
    console.log(`📌 Mint: ${TEST_MINT.substring(0, 8)}...`);
    console.log(`📌 Bonding Curve: ${bondingCurveAddress.substring(0, 8)}...\n`);
  } catch (e) {
    console.error('❌ Invalid mint address');
    process.exit(1);
  }

  try {
    const stream = await client.subscribe();
    console.log('✅ Stream connected!\n');

    let updateCount = 0;
    const { PublicKey: SolanaPublicKey } = require('@solana/web3.js');

    stream.on('data', (data: any) => {
      if (data.account) {
        const accountPubkey = data.account.account?.pubkey;
        if (!accountPubkey) return;
        
        // Convert buffer to base58
        let accountAddress: string;
        try {
          accountAddress = new SolanaPublicKey(accountPubkey).toBase58();
        } catch (e) {
          return;
        }
        
        // Check if this is our bonding curve
        if (accountAddress === bondingCurveAddress) {
          updateCount++;
          
          console.log('\n' + '='.repeat(80));
          console.log(`🟢 Pump.fun Update #${updateCount} - ${new Date().toLocaleTimeString()}`);
          console.log('='.repeat(80));
          
          const account = data.account.account;
          const slot = data.account.slot;
          
          console.log('📊 Account Info:');
          console.log('   Address:', accountAddress);
          console.log('   Slot:', slot);
          console.log('   Lamports:', account.lamports);
          console.log('   Owner:', new SolanaPublicKey(account.owner).toBase58());
          
          if (account.data && account.data.length > 0) {
            const priceData = parsePrice(account.data);
            console.log('\n💰 Bonding Curve Data:');
            console.log('   SOL Reserve:', priceData.solReserve.toLocaleString());
            console.log('   Token Reserve:', priceData.tokenReserve.toLocaleString());
            if (priceData.price) {
              console.log('   Price (SOL per token):', priceData.price.toExponential(4));
            }
            console.log('   Data Length:', account.data.length, 'bytes');
          } else {
            console.log('\n⚠️  Account data is empty (token may have graduated)');
          }
          
          if (account.txnSignature) {
            const sig = Buffer.from(account.txnSignature).toString('base64').substring(0, 20);
            console.log('\n📝 Transaction:', sig + '...');
          }
        }
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
    });

    stream.on('end', () => {
      console.log('\n⚠️  Stream ended');
    });

    // Subscribe to bonding curve account
    console.log('📡 Subscribing to bonding curve account...');
    
    const subscribeRequest = {
      accounts: {
        'pumpfun-bonding-curve': {
          account: [bondingCurveAddress],
          owner: [],
          filters: [],
        },
      },
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
    };

    stream.write(subscribeRequest);
    console.log(`✅ Subscribed to bonding curve: ${bondingCurveAddress.substring(0, 16)}...`);
    console.log('\n⏳ Waiting for Pump.fun updates... (Press Ctrl+C to stop)\n');
    console.log('💡 Tip: Use a real Pump.fun token mint to see live updates!');
    console.log('   Example: ts-node test-pumpfun-feed.ts <PUMP_FUN_MINT>\n');

    // Keep running
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      console.log(`📊 Total updates received: ${updateCount}`);
      stream.end();
      process.exit(0);
    });

  } catch (error: any) {
    console.error('❌ Failed to connect:', error.message);
    process.exit(1);
  }
}

testPumpfunFeed().catch(console.error);
