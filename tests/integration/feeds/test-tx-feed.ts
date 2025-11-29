#!/usr/bin/env ts-node
/**
 * Test Transaction Feed - Shows Real Solana Transactions
 */

import 'dotenv/config';

async function testTxFeed() {
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

    let txCount = 0;
    let slotCount = 0;
    const startTime = Date.now();

    stream.on('data', (data: any) => {
      // Handle slot updates
      if (data.slot) {
        slotCount++;
        if (slotCount % 100 === 0) {
          console.log(`\n🎰 Slot: ${data.slot.slot} (${slotCount} slots processed)`);
        }
      }
      
      // Handle transaction updates
      if (data.transaction) {
        txCount++;
        const txData = data.transaction;
        const slot = txData.slot;
        
        // Print every 5th transaction
        if (txCount % 5 === 0 || txCount <= 10) {
          const txInfo = txData.transaction;
          if (!txInfo) return;
          
          // Get signature
          let sig = '';
          if (txInfo.signature) {
            sig = Buffer.from(txInfo.signature).toString('base64');
          } else if (txInfo.transaction?.signatures?.[0]) {
            const sigBuf = txInfo.transaction.signatures[0];
            sig = Buffer.isBuffer(sigBuf) ? sigBuf.toString('base64') : sigBuf;
          }
          
          const sigShort = sig ? sig.substring(0, 16) + '...' : 'N/A';
          
          // Get transaction details
          const tx = txInfo.transaction;
          const meta = txInfo.meta;
          const isVote = txInfo.isVote || false;
          
          console.log(`\n💸 TX #${txCount} | Slot: ${slot} | ${isVote ? '🗳️  VOTE' : '💸 TX'}`);
          console.log(`   Signature: ${sigShort}`);
          
          if (tx?.message) {
            const header = tx.message.header || {};
            const numAccounts = tx.message.accountKeys?.length || 0;
            console.log(`   Accounts: ${header.numRequiredSignatures || 1} signed, ${numAccounts} total`);
          }
          
          if (meta) {
            if (meta.err) {
              console.log(`   Status: ❌ Failed`);
            } else {
              console.log(`   Status: ✅ Success`);
            }
            if (meta.fee) {
              const feeSol = (Number(meta.fee) / 1e9).toFixed(9);
              console.log(`   Fee: ${meta.fee} lamports (${feeSol} SOL)`);
            }
          }
        }
      }
      
      // Show summary every 5 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 5000 < 100) {
        const rate = (txCount / (elapsed / 1000)).toFixed(1);
        console.log(`\n📊 Stats: ${txCount} transactions, ${slotCount} slots, ${rate} tx/s`);
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
      if (error.code) console.error('   Code:', error.code);
    });

    stream.on('end', () => {
      console.log('\n⚠️  Stream ended');
    });

    // Subscribe to transactions
    console.log('📡 Subscribing to transactions...');
    
    const subscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
        'all-txs': {
          accountInclude: [], // Empty = all accounts
          accountExclude: [],
          accountRequired: [],
          vote: true, // Include vote transactions
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
    console.log('✅ Subscribed to all transactions');
    console.log('\n⏳ Waiting for transactions... (Press Ctrl+C to stop)\n');
    console.log('💡 You should see transactions appearing below...\n');

    // Keep running
    process.on('SIGINT', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n\n🛑 Stopping...');
      console.log(`📊 Final Stats (${elapsed}s):`);
      console.log(`   Transactions: ${txCount}`);
      console.log(`   Slots: ${slotCount}`);
      stream.end();
      process.exit(0);
    });

  } catch (error: any) {
    console.error('❌ Failed to connect:', error.message);
    process.exit(1);
  }
}

testTxFeed().catch(console.error);
