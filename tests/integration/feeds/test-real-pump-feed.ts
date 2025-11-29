#!/usr/bin/env ts-node
/**
 * Test Real Pump.fun Feed with Decoded Data
 * Shows actual streaming data from Pump.fun bonding curves
 */

import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { decodeBondingCurveAccount, calculatePriceFromBondingCurve, PUMP_PROGRAM_ID } from './src/monitoring/pump-idl-decoder';

// Reverse mapping: bonding curve address -> mint address
const bondingCurveToMint = new Map<string, string>();

function deriveBondingCurve(mint: string): string {
  try {
    const mintPubkey = new PublicKey(mint);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      PUMP_PROGRAM_ID
    );
    const address = bondingCurve.toBase58();
    // Store reverse mapping
    bondingCurveToMint.set(address, mint);
    return address;
  } catch (e) {
    return '';
  }
}

/**
 * Get mint address from bonding curve address
 * Uses reverse mapping if available
 */
function getMintFromBondingCurve(bondingCurveAddress: string): string | null {
  return bondingCurveToMint.get(bondingCurveAddress) || null;
}

async function testRealFeed() {
  console.log('🔌 Connecting to Yellowstone gRPC...\n');
  
  const yellowstone = require('@triton-one/yellowstone-grpc');
  const Client = yellowstone.default;
  const CommitmentLevel = yellowstone.CommitmentLevel;
  
  const client = new Client(
    process.env.SHYFT_GRPC_URL || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_X_TOKEN
  );

  // Subscribe to multiple Pump.fun tokens (you can add real mints here)
  const TEST_MINTS = process.argv.slice(2);
  
  if (TEST_MINTS.length === 0) {
    console.log('⚠️  No mints provided. Subscribing to all Pump.fun bonding curves...');
    console.log('💡 Usage: ts-node test-real-pump-feed.ts <MINT1> <MINT2> ...');
    console.log('💡 Example: ts-node test-real-pump-feed.ts So11111111111111111111111111111111111111112\n');
  }

  try {
    const stream = await client.subscribe();
    console.log('✅ Stream connected!\n');

    let updateCount = 0;
    let decodedCount = 0;
    let failedDecodeCount = 0;
    const startTime = Date.now();
    const bondingCurveAddresses = new Set<string>();

    // Derive bonding curve addresses
    if (TEST_MINTS.length > 0) {
      TEST_MINTS.forEach(mint => {
        const addr = deriveBondingCurve(mint);
        if (addr) {
          bondingCurveAddresses.add(addr);
          console.log(`📌 ${mint.substring(0, 8)}... → ${addr.substring(0, 16)}...`);
        }
      });
    }

    stream.on('data', (data: any) => {
      if (data.account) {
        const account = data.account.account;
        const accountData = data.account.data;
        const slot = data.account.slot;
        
        updateCount++;
        
        // Convert account pubkey to base58
        let accountAddress: string | null = null;
        try {
          if (account?.pubkey) {
            accountAddress = new PublicKey(account.pubkey).toBase58();
          } else if (Buffer.isBuffer(account) || account instanceof Uint8Array) {
            accountAddress = new PublicKey(account).toBase58();
          } else if (typeof account === 'string') {
            accountAddress = account;
          }
        } catch (e) {
          // Skip invalid
          return;
        }
        
        if (!accountAddress) return;
        
        // Check if this is a Pump.fun bonding curve (by owner or by address match)
        const owner = account?.owner;
        let isPumpFun = false;
        
        if (owner) {
          try {
            const ownerPubkey = Buffer.isBuffer(owner) || owner instanceof Uint8Array
              ? new PublicKey(owner).toBase58()
              : owner;
            isPumpFun = ownerPubkey === PUMP_PROGRAM_ID.toBase58();
          } catch (e) {}
        }
        
        // Also check if it's in our list
        if (bondingCurveAddresses.size > 0) {
          isPumpFun = bondingCurveAddresses.has(accountAddress);
        }
        
        // Debug: Log account structure
        if (updateCount <= 3) {
          console.log(`\n🔍 [DEBUG] Update #${updateCount}:`);
          console.log(`   Full account object keys:`, Object.keys(data.account.account || {}));
          console.log(`   Account: ${accountAddress?.substring(0, 20) || 'N/A'}...`);
          console.log(`   Owner: ${owner ? (Buffer.isBuffer(owner) ? new PublicKey(owner).toBase58() : owner) : 'N/A'}`);
          console.log(`   accountData:`, accountData ? `${accountData.constructor?.name || typeof accountData}, length: ${accountData.length || 'N/A'}` : 'null/undefined');
          
          // Check if data is in account.account.data
          const accountObj = data.account.account;
          if (accountObj) {
            console.log(`   account.account.data:`, accountObj.data ? `${accountObj.data.constructor?.name || typeof accountObj.data}, length: ${accountObj.data.length || 'N/A'}` : 'null/undefined');
            console.log(`   account.account.lamports:`, accountObj.lamports);
            console.log(`   account.account.owner:`, accountObj.owner ? (Buffer.isBuffer(accountObj.owner) ? new PublicKey(accountObj.owner).toBase58() : accountObj.owner) : 'N/A');
          }
          
          // Check data.account structure
          console.log(`   data.account keys:`, Object.keys(data.account));
        }
        
        // Try to get account data from different locations
        let actualAccountData = accountData;
        if (!actualAccountData || actualAccountData.length === 0) {
          const accountObj = data.account.account;
          if (accountObj?.data) {
            actualAccountData = accountObj.data;
          } else if (accountObj?.account?.data) {
            actualAccountData = accountObj.account.data;
          }
        }
        
        // Try to decode if it's Pump.fun or if we don't have a filter
        if (isPumpFun || bondingCurveAddresses.size === 0) {
          if (actualAccountData && actualAccountData.length > 0) {
            // Convert to Buffer
            let dataBuffer: Buffer;
            try {
              if (Buffer.isBuffer(actualAccountData)) {
                dataBuffer = actualAccountData;
              } else if (typeof actualAccountData === 'string') {
                dataBuffer = Buffer.from(actualAccountData, 'base64');
              } else if (actualAccountData instanceof Uint8Array) {
                dataBuffer = Buffer.from(actualAccountData);
              } else {
                if (updateCount <= 5) {
                  console.log(`   ⚠️  Unknown accountData type: ${typeof actualAccountData}`);
                }
                return;
              }
              
              // Check discriminator first
              if (dataBuffer.length >= 8) {
                const discriminator = Array.from(dataBuffer.slice(0, 8));
                if (updateCount <= 5) {
                  console.log(`   Discriminator: [${discriminator.join(', ')}]`);
                }
              }
              
              // Try to decode
              const decoded = decodeBondingCurveAccount(dataBuffer);
              
              if (decoded) {
                decodedCount++;
                
                // Debug: log first decoded account structure
                if (decodedCount === 1) {
                  console.log('\n🔍 [DEBUG] Decoded account structure:');
                  console.log(JSON.stringify(decoded, (key, value) => {
                    if (value && typeof value === 'object' && value.constructor?.name === 'PublicKey') {
                      return value.toBase58();
                    }
                    if (value && typeof value === 'object' && value.constructor?.name === 'BN') {
                      return value.toString();
                    }
                    return value;
                  }, 2));
                }
                
                const price = calculatePriceFromBondingCurve(decoded, 150);
                
                console.log('\n' + '='.repeat(80));
                console.log(`🟢 DECODED Pump.fun Update #${decodedCount} - ${new Date().toLocaleTimeString()}`);
                console.log('='.repeat(80));
                // Helper to convert BN/string to readable format
                const formatBN = (val: any): string => {
                  if (!val) return 'N/A';
                  if (typeof val === 'string') {
                    // Handle hex strings
                    if (val.startsWith('0x')) {
                      return BigInt(val).toString();
                    }
                    return val;
                  }
                  return val.toString();
                };
                
                const formatPubkey = (val: any): string => {
                  if (!val) return 'N/A';
                  if (typeof val === 'string') return val.substring(0, 16) + '...';
                  if (val.toBase58) return val.toBase58().substring(0, 16) + '...';
                  return 'N/A';
                };
                
                // Try to get mint from reverse mapping
                const mintAddress = getMintFromBondingCurve(accountAddress);
                
                console.log(`📊 Account: ${accountAddress.substring(0, 16)}...`);
                console.log(`   Mint: ${mintAddress ? formatPubkey(mintAddress) : 'N/A (not in mapping - add mint to derive)'}`);
                console.log(`   Real SOL Reserves: ${formatBN(decoded.real_sol_reserves)}`);
                console.log(`   Real Token Reserves: ${formatBN(decoded.real_token_reserves)}`);
                console.log(`   Virtual SOL: ${formatBN(decoded.virtual_sol_reserves)}`);
                console.log(`   Virtual Token: ${formatBN(decoded.virtual_token_reserves)}`);
                console.log(`   Token Total Supply: ${formatBN(decoded.token_total_supply)}`);
                console.log(`   Complete: ${decoded.complete ?? 'N/A'}`);
                console.log(`   Creator: ${formatPubkey(decoded.creator)}`);
                console.log(`💰 Price: $${price.toFixed(8)} USD`);
                console.log(`   Slot: ${slot}`);
              } else {
                failedDecodeCount++;
                if (updateCount <= 5 || failedDecodeCount % 50 === 0) {
                  console.log(`⚠️  Failed to decode (not a BondingCurve account)`);
                  if (dataBuffer.length >= 8) {
                    const disc = Array.from(dataBuffer.slice(0, 8));
                    console.log(`   Discriminator: [${disc.join(', ')}] (expected: [23, 183, 248, 55, 96, 216, 172, 96])`);
                  }
                }
              }
            } catch (e: any) {
              failedDecodeCount++;
              if (updateCount <= 5) {
                console.log(`   ❌ Decode error: ${e.message}`);
              }
            }
          } else {
            if (updateCount <= 5) {
              console.log(`   ⚠️  No account data`);
            }
          }
        }
        
        // Show stats every 50 updates
        if (updateCount % 50 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`\n📈 Stats (${elapsed}s): ${updateCount} updates, ${decodedCount} decoded, ${failedDecodeCount} failed`);
        }
      }
    });

    stream.on('error', (error: any) => {
      console.error('\n❌ Stream Error:', error.message);
    });

    // Subscribe to Pump.fun program accounts
    console.log('\n📡 Subscribing to Pump.fun accounts...');
    
    const accountsObject: { [key: string]: any } = {};
    
    if (bondingCurveAddresses.size > 0) {
      // Subscribe to specific bonding curves
      let idx = 0;
      bondingCurveAddresses.forEach(addr => {
        accountsObject[`pump-${idx++}`] = {
          account: [addr],
          owner: [],
          filters: [],
        };
      });
      console.log(`✅ Subscribed to ${bondingCurveAddresses.size} specific bonding curves`);
    } else {
      // Subscribe to all Pump.fun program accounts
      accountsObject['pump-fun-all'] = {
        account: [],
        owner: [PUMP_PROGRAM_ID.toBase58()], // Filter by owner = Pump.fun program
        filters: [],
      };
      console.log(`✅ Subscribed to all Pump.fun program accounts (owner: ${PUMP_PROGRAM_ID.toBase58().substring(0, 16)}...)`);
    }
    
    // Request full account data (empty array means return all data)
    const subscribeRequest = {
      accounts: accountsObject,
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [], // Empty = return all account data
    };

    stream.write(subscribeRequest);
    console.log('\n⏳ Waiting for Pump.fun updates... (Press Ctrl+C to stop)\n');

    process.on('SIGINT', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n\n🛑 Stopping...');
      console.log(`📊 Final Stats (${elapsed}s):`);
      console.log(`   Total Updates: ${updateCount}`);
      console.log(`   Decoded: ${decodedCount}`);
      console.log(`   Failed: ${failedDecodeCount}`);
      stream.end();
      process.exit(0);
    });

  } catch (error: any) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

testRealFeed().catch(console.error);
