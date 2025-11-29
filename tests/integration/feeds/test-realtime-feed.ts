#!/usr/bin/env ts-node
/**
 * Test Real-Time Feed
 * Shows actual data coming through Yellowstone gRPC
 */

import 'dotenv/config';

// Test with a real Pump.fun token or popular Solana token
const TEST_MINTS = [
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
];

async function testRealtimeFeed() {
  console.log('🔌 Connecting to Yellowstone gRPC...\n');
  
  const yellowstone = require('@triton-one/yellowstone-grpc');
  const Client = yellowstone.default;
  const CommitmentLevel = yellowstone.CommitmentLevel;
  
  const client = new Client(
    process.env.SHYFT_GRPC_URL || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_X_TOKEN
  );

  try {
    const stream = await client.subscribe();
    console.log('✅ Stream connected!\n');

    let updateCount = 0;
    let lastLogTime = Date.now();

    stream.on('data', (data: any) => {
      updateCount++;
      const now = Date.now();
      
      // Log every update (or every 5 seconds if too many)
      if (now - lastLogTime > 5000 || updateCount === 1) {
        console.log('\n' + '='.repeat(80));
        console.log(`📡 Update #${updateCount} - ${new Date().toLocaleTimeString()}`);
        console.log('='.repeat(80));
        
        if (data.account) {
          console.log('📊 Account Update:');
          console.log('   Account:', data.account.account);
          console.log('   Slot:', data.account.slot);
          console.log('   Owner:', data.account.owner);
          console.log('   Lamports:', data.account.lamports);
          console.log('   Executable:', data.account.executable);
          console.log('   Rent Epoch:', data.account.rentEpoch);
          if (data.account.data) {
            const dataLength = Array.isArray(data.account.data) 
              ? data.account.data.length 
              : (data.account.data?.length || 0);
            console.log('   Data Length:', dataLength, 'bytes');
            if (dataLength > 0 && dataLength < 200) {
              console.log('   Data Preview:', JSON.stringify(data.account.data).substring(0, 100));
            }
          }
        }
        
        if (data.slot) {
          console.log('🎰 Slot Update:');
          console.log('   Slot:', data.slot.slot);
          console.log   ('   Parent:', data.slot.parent);
          console.log('   Status:', data.slot.status);
        }
        
        if (data.transaction) {
          console.log('💸 Transaction Update:');
          console.log('   Signature:', data.transaction.transaction?.signatures?.[0]?.substring(0, 20) + '...');
          console.log('   Slot:', data.transaction.slot);
        }
        
        if (data.ping) {
          console.log('🏓 Ping:', data.ping);
        }
        
        lastLogTime = now;
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
      if (error.code) {
        console.error('   Code:', error.code);
      }
    });

    stream.on('end', () => {
      console.log('\n⚠️  Stream ended');
    });

    // Subscribe to SOL and USDC accounts
    console.log('\n📡 Subscribing to accounts...');
    
    const accountsObject: { [key: string]: any } = {};
    
    TEST_MINTS.forEach((mint, i) => {
      accountsObject[`token-${i}`] = {
        account: [mint],
        owner: [],
        filters: [],
      };
    });

    const subscribeRequest = {
      accounts: accountsObject,
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
    console.log(`✅ Subscribed to ${TEST_MINTS.length} accounts`);
    console.log('   Accounts:', TEST_MINTS.map(m => m.substring(0, 8) + '...').join(', '));
    console.log('\n⏳ Waiting for updates... (Press Ctrl+C to stop)\n');

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

testRealtimeFeed().catch(console.error);
