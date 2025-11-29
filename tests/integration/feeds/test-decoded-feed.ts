#!/usr/bin/env ts-node
/**
 * Test Decoded Real-Time Feed
 * Shows properly decoded Pump.fun bonding curve data
 */

import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { decodeBondingCurveAccount, calculatePriceFromBondingCurve, PUMP_PROGRAM_ID } from './src/monitoring/pump-idl-decoder';

function deriveBondingCurve(mint: string): string {
  const mintPubkey = new PublicKey(mint);
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return bondingCurve.toBase58();
}

async function testDecodedFeed() {
  console.log('🔌 Connecting to Yellowstone gRPC...\n');
  
  const yellowstone = require('@triton-one/yellowstone-grpc');
  const Client = yellowstone.default;
  const CommitmentLevel = yellowstone.CommitmentLevel;
  
  const client = new Client(
    process.env.SHYFT_GRPC_URL || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_X_TOKEN
  );

  // Use a real Pump.fun token mint (replace with actual mint)
  const TEST_MINT = process.argv[2] || 'So11111111111111111111111111111111111111112';
  const bondingCurveAddress = deriveBondingCurve(TEST_MINT);
  
  console.log(`📌 Mint: ${TEST_MINT.substring(0, 8)}...`);
  console.log(`📌 Bonding Curve: ${bondingCurveAddress.substring(0, 16)}...\n`);

  try {
    const stream = await client.subscribe();
    console.log('✅ Stream connected!\n');

    let updateCount = 0;

    stream.on('data', (data: any) => {
      if (data.account) {
        const account = data.account.account;
        const accountData = data.account.data;
        const slot = data.account.slot;
        
        // Convert account pubkey to base58
        let accountAddress: string | null = null;
        try {
          if (account?.pubkey) {
            accountAddress = new PublicKey(account.pubkey).toBase58();
          } else if (Buffer.isBuffer(account) || account instanceof Uint8Array) {
            accountAddress = new PublicKey(account).toBase58();
          }
        } catch (e) {
          return;
        }
        
        if (accountAddress === bondingCurveAddress && accountData && accountData.length > 0) {
          updateCount++;
          
          // Convert to Buffer
          let dataBuffer: Buffer;
          if (Buffer.isBuffer(accountData)) {
            dataBuffer = accountData;
          } else if (typeof accountData === 'string') {
            dataBuffer = Buffer.from(accountData, 'base64');
          } else {
            dataBuffer = Buffer.from(accountData);
          }
          
          // Decode using IDL
          const decoded = decodeBondingCurveAccount(dataBuffer);
          
          if (decoded) {
            console.log('\n' + '='.repeat(80));
            console.log(`🟢 Decoded Update #${updateCount} - ${new Date().toLocaleTimeString()}`);
            console.log('='.repeat(80));
            console.log(`📊 Bonding Curve Account:`);
            console.log(`   Mint: ${decoded.mint.toBase58()}`);
            console.log(`   SOL Reserves: ${decoded.solReserves.toString()}`);
            console.log(`   Token Reserves: ${decoded.tokenReserves.toString()}`);
            console.log(`   Virtual SOL: ${decoded.virtualSolReserves.toString()}`);
            console.log(`   Virtual Token: ${decoded.virtualTokenReserves.toString()}`);
            console.log(`   Complete: ${decoded.complete}`);
            console.log(`   Creator: ${decoded.creator.toBase58()}`);
            console.log(`   Buy Royalty: ${decoded.buyRoyaltyPercentage}%`);
            console.log(`   Sell Royalty: ${decoded.sellRoyaltyPercentage}%`);
            
            const price = calculatePriceFromBondingCurve(decoded, 150);
            console.log(`\n💰 Price: $${price.toFixed(8)} USD`);
            console.log(`   Slot: ${slot}`);
          } else {
            console.log(`⚠️  Failed to decode account data (${dataBuffer.length} bytes)`);
          }
        }
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
    });

    // Subscribe
    const subscribeRequest = {
      accounts: {
        'pump-bonding-curve': {
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
    console.log(`✅ Subscribed to bonding curve`);
    console.log('\n⏳ Waiting for decoded updates... (Press Ctrl+C to stop)\n');

    process.on('SIGINT', () => {
      console.log(`\n📊 Total updates: ${updateCount}`);
      stream.end();
      process.exit(0);
    });

  } catch (error: any) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

testDecodedFeed().catch(console.error);
