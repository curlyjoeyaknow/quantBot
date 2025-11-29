const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const axios = require('axios');

const LSY_CALLS_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_LOG = path.join(__dirname, '../data/exports/lsy_ohlcv_fetch_log.json');

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE = 'https://public-api.birdeye.so';

/**
 * Fetch OHLCV data from Birdeye API
 */
async function fetchOHLCV(address, startTime, endTime, chain) {
  try {
    const start = Math.floor(new Date(startTime).getTime() / 1000);
    const end = Math.floor(new Date(endTime).getTime() / 1000);
    
    const url = `${BIRDEYE_BASE}/defi/history_price?address=${address}&address_type=token&type=1m&time_from=${start}&time_to=${end}`;
    
    const response = await axios.get(url, {
      headers: { 
        'X-API-KEY': BIRDEYE_API_KEY,
        'x-chain': chain === 'solana' ? 'solana' : chain
      }
    });
    
    return response.data?.items || [];
  } catch (error) {
    console.error(`❌ Error fetching OHLCV for ${address}:`, error.message);
    return [];
  }
}

/**
 * Main function to fetch OHLCV candles for all LSY calls
 */
async function fetchAllLSYOHLCV() {
  console.log('🚀 Starting OHLCV fetch for all LSY calls...\n');

  try {
    // Read the LSY calls CSV
    console.log(`📖 Reading LSY calls from: ${LSY_CALLS_CSV}`);
    const csv = fs.readFileSync(LSY_CALLS_CSV, 'utf8');
    
    const records = await new Promise((resolve, reject) => {
      parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });

    console.log(`📊 Found ${records.length} LSY calls\n`);

    // Filter out fake addresses (containing '4444')
    const validRecords = records.filter(record => !record.tokenAddress.includes('4444'));
    console.log(`✅ Valid records (excluding fake addresses): ${validRecords.length}\n`);

    const results = [];

    // Process each record
    for (let i = 0; i < validRecords.length; i++) {
      const call = validRecords[i];
      
      console.log(`\n🔄 [${i + 1}/${validRecords.length}] Processing: ${call.tokenAddress.substring(0, 30)}...`);
      
      try {
        // Calculate time range: alert time to 7 days later
        const alertDate = new Date(call.timestamp);
        const endDate = new Date(alertDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
        
        console.log(`   📅 From: ${alertDate.toISOString()}`);
        console.log(`   📅 To:   ${endDate.toISOString()}`);
        console.log(`   🔗 Chain: ${call.chain}`);
        
        // Fetch OHLCV data
        const candles = await fetchOHLCV(call.tokenAddress, alertDate, endDate, call.chain);
        
        if (candles.length > 0) {
          const firstPrice = candles[0].close;
          const lastPrice = candles[candles.length - 1].close;
          const multiplier = lastPrice / firstPrice;
          
          results.push({
            tokenAddress: call.tokenAddress,
            tokenSymbol: call.tokenSymbol || 'UNKNOWN',
            chain: call.chain,
            alertTime: call.timestamp,
            success: true,
            candlesCount: candles.length,
            entryPrice: firstPrice,
            finalPrice: lastPrice,
            multiplier: multiplier.toFixed(2) + 'x',
            priceChange: ((multiplier - 1) * 100).toFixed(2) + '%'
          });
          
          console.log(`   ✅ Success! ${candles.length} candles fetched`);
          console.log(`   💰 Entry: ${firstPrice}, Final: ${lastPrice}, Multiplier: ${multiplier.toFixed(2)}x`);
        } else {
          results.push({
            tokenAddress: call.tokenAddress,
            tokenSymbol: call.tokenSymbol || 'UNKNOWN',
            chain: call.chain,
            alertTime: call.timestamp,
            success: false,
            candlesCount: 0,
            error: 'No candles returned from API'
          });
          
          console.log(`   ⚠️ No candles returned`);
        }
        
        // Rate limiting delay
        await new Promise(r => setTimeout(r, 1500)); // 1.5 second delay between requests
        
      } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        results.push({
          tokenAddress: call.tokenAddress,
          tokenSymbol: call.tokenSymbol || 'UNKNOWN',
          chain: call.chain,
          alertTime: call.timestamp,
          success: false,
          candlesCount: 0,
          error: error.message
        });
      }
    }

    console.log(`\n\n✅ OHLCV fetch complete!`);
    console.log(`📊 Summary:`);
    console.log(`   Total calls: ${validRecords.length}`);
    console.log(`   Successful: ${results.filter(r => r.success).length}`);
    console.log(`   Failed: ${results.filter(r => !r.success).length}`);
    console.log(`   Total candles fetched: ${results.reduce((sum, r) => sum + (r.candlesCount || 0), 0)}`);

    // Save results to log file
    fs.writeFileSync(OUTPUT_LOG, JSON.stringify(results, null, 2));
    console.log(`\n📝 Results saved to: ${OUTPUT_LOG}`);

    // Show summary by chain
    const solanaCount = results.filter(r => r.chain === 'solana' && r.success).length;
    const bscCount = results.filter(r => r.chain === 'bsc' && r.success).length;
    console.log(`\n📈 By Chain:`);
    console.log(`   Solana: ${solanaCount} successful`);
    console.log(`   BSC: ${bscCount} successful`);

    // Show top performers
    const successful = results.filter(r => r.success);
    if (successful.length > 0) {
      console.log(`\n🏆 Top 5 Performers by Multiplier:`);
      successful.sort((a, b) => parseFloat(b.multiplier) - parseFloat(a.multiplier));
      successful.slice(0, 5).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.tokenSymbol} - ${r.multiplier} (${r.priceChange})`);
      });
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  fetchAllLSYOHLCV()
    .then(() => {
      console.log('\n🎉 Script completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fetchAllLSYOHLCV };

