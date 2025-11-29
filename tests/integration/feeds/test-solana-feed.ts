#!/usr/bin/env ts-node
/**
 * Test General Solana Real-Time Feed
 * Shows slots, transactions, and account updates
 */

import 'dotenv/config';

async function testSolanaFeed() {
  console.log('🔌 Connecting to Yellowstone gRPC for Solana feed...\n');
  
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

    let slotCount = 0;
    let txCount = 0;
    let accountCount = 0;
    const startTime = Date.now();

    stream.on('data', (data: any) => {
      const now = Date.now();
      
      if (data.slot) {
        slotCount++;
        if (slotCount % 10 === 0 || slotCount === 1) {
          console.log(`\n🎰 Slot #${slotCount}: ${data.slot.slot} (parent: ${data.slot.parent})`);
        }
      }
      
      if (data.transaction) {
        txCount++;
        const tx = data.transaction.transaction;
        if (tx && tx.signatures && tx.signatures.length > 0) {
          const sig = tx.signatures[0].substring(0, 16) + '...';
          console.log(`💸 Transaction #${txCount}: ${sig} (slot: ${data.transaction.slot})`);
        }
      }
      
      if (data.account) {
        accountCount++;
        const account = data.account.account;
        if (account && account.pubkey) {
          const { PublicKey } = require('@solana/web3.js');
          try {
            const pubkey = new PublicKey(account.pubkey).toBase58();
            if (accountCount % 5 === 0 || accountCount === 1) {
              console.log(`📊 Account Update #${accountCount}: ${pubkey.substring(0, 16)}... (slot: ${data.account.slot})`);
            }
          } catch (e) {
            // Skip invalid pubkeys
          }
        }
      }
      
      if (data.ping) {
        console.log('🏓 Ping received');
      }
      
      // Show summary every 10 seconds
      if ((now - startTime) % 10000 < 100) {
        const elapsed = ((now - startTime) / 1000).toFixed(1);
        console.log(`\n📈 Summary (${elapsed}s): Slots: ${slotCount}, Transactions: ${txCount}, Accounts: ${accountCount}`);
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
    });

    stream.on('end', () => {
      console.log('\n⚠️  Stream ended');
    });

    // Subscribe to slots and transactions
    console.log('📡 Subscribing to Solana feed...');
    
    const subscribeRequest = {
      accounts: {},
      slots: {
        'mainnet-slots': {
          filter: {}, // Empty filter = all slots
        },
      },
      transactions: {
        'mainnet-txs': {
          // Subscribe to all transactions
          accountInclude: [], // Empty = all accounts
          accountExclude: [],
          accountRequired: [],
          vote: false, // Include vote transactions
          failed: false, // Exclude failed transactions
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
    };

    stream.write(subscribeRequest);
    console.log('✅ Subscribed to Solana slots and transactions');
    console.log('\n⏳ Receiving real-time Solana feed... (Press Ctrl+C to stop)\n');

    // Keep running
    process.on('SIGINT', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n\n🛑 Stopping...');
      console.log(`📊 Summary (${elapsed}s):`);
      console.log(`   Slots: ${slotCount}`);
      console.log(`   Transactions: ${txCount}`);
      console.log(`   Accounts: ${accountCount}`);
      stream.end();
      process.exit(0);
    });

  } catch (error: any) {
    console.error('❌ Failed to connect:', error.message);
    process.exit(1);
  }
}

testSolanaFeed().catch(console.error);
