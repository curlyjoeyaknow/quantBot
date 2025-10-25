const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

// Configuration
const MESSAGES_DIR = './messages'; // Process all message files
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb']; // Exclude these users as requested

// Parse timestamp from HTML format
function parseTimestamp(timestampStr) {
  try {
    // Handle formats like "22.10.2025 11:38:15 UTC+10:00"
    // Convert DD.MM.YYYY to MM/DD/YYYY format for JavaScript Date parsing
    const parts = timestampStr.split(' ');
    if (parts.length >= 2) {
      const datePart = parts[0]; // "22.10.2025"
      const timePart = parts[1]; // "11:38:15"
      const timezonePart = parts[2]; // "UTC+10:00"
      
      // Parse DD.MM.YYYY format
      const dateComponents = datePart.split('.');
      if (dateComponents.length === 3) {
        const day = dateComponents[0];
        const month = dateComponents[1];
        const year = dateComponents[2];
        
        // Create ISO string format
        const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`;
        
        // Handle timezone
        let timezoneOffset = '';
        if (timezonePart) {
          if (timezonePart.includes('UTC+')) {
            timezoneOffset = timezonePart.replace('UTC+', '+');
          } else if (timezonePart.includes('UTC-')) {
            timezoneOffset = timezonePart.replace('UTC-', '-');
          }
        }
        
        const fullTimestamp = isoString + timezoneOffset;
        const date = new Date(fullTimestamp);
        
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
    
    // Fallback: try original parsing
    let cleanTimestamp = timestampStr;
    cleanTimestamp = cleanTimestamp.replace(/UTC\+(\d{2}):(\d{2})/g, '+$1:$2');
    cleanTimestamp = cleanTimestamp.replace(/UTC\-(\d{2}):(\d{2})/g, '-$1:$2');
    
    const date = new Date(cleanTimestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date().toISOString(); // Fallback to current time
    
  } catch (error) {
    console.warn(`Error parsing timestamp ${timestampStr}:`, error.message);
    return new Date().toISOString(); // Fallback to current time
  }
}

// Save extracted CA drops to database
async function saveToDatabase(results) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./simulations.db', (err) => {
      if (err) {
        console.error('Error connecting to database:', err);
        reject(err);
        return;
      }
    });

    // Prepare insert statement
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO ca_calls 
      (mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, caller, source_chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let savedCount = 0;
    let skippedCount = 0;

    db.serialize(() => {
      db.run('BEGIN TRANSACTION;');
      
      results.forEach(drop => {
        const userId = 1; // Default user ID for extracted data
        const chatId = 1; // Default chat ID for extracted data
        const callTimestamp = Math.floor(new Date(drop.timestamp).getTime() / 1000);
        const defaultStrategy = JSON.stringify([
          { percent: 0.5, target: 2 },
          { percent: 0.3, target: 5 },
          { percent: 0.2, target: 10 }
        ]);
        const defaultStopLoss = JSON.stringify({ initial: -0.5, trailing: 0.5 });

        insertStmt.run(
          drop.address,
          drop.chain,
          drop.metadata.name,
          drop.metadata.symbol,
          drop.priceData?.price || 0,
          drop.priceData?.marketCap || 0,
          callTimestamp,
          drop.caller,
          chatId,
          function(err) {
            if (err) {
              console.error('Error inserting CA drop:', err);
              skippedCount++;
            } else {
              if (this.changes > 0) {
                savedCount++;
              } else {
                skippedCount++; // Already exists
              }
            }
          }
        );
      });

      db.run('COMMIT;', (err) => {
        if (err) {
          console.error('Error committing transaction:', err);
          reject(err);
        } else {
          console.log(`📊 Database save complete: ${savedCount} new, ${skippedCount} skipped (already exists)`);
          insertStmt.finalize();
          db.close();
          resolve();
        }
      });
    });
  });
}

// Simple extraction function
function extractCADrops() {
  const caDrops = [];
  const files = fs.readdirSync(MESSAGES_DIR)
    .filter(file => file.startsWith('messages') && file.endsWith('.html'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/messages(\d+)\.html/)?.[1] || '0');
      const numB = parseInt(b.match(/messages(\d+)\.html/)?.[1] || '0');
      return numB - numA; // Most recent first
    });

  console.log(`Found ${files.length} message files`);

  // Process all brook files
  // Process files one at a time to avoid overwhelming the system
  const filesToProcess = files.slice(2, 3); // Process the NEXT file (messages15.html)
  console.log(`Processing ${filesToProcess.length} file(s) for CA extraction...`);
  
  for (const file of filesToProcess) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(MESSAGES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Find all message blocks using regex
    const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)(?=<div class="message|$)/g;
    let match;
    let processedCount = 0;
    const maxPerFile = 50; // Limit to 50 CA drops per file
    
    while ((match = messageRegex.exec(content)) !== null && processedCount < maxPerFile) {
      const messageId = match[1];
      const messageContent = match[2];
      
      // Extract timestamp
      const timestampMatch = messageContent.match(/title="([^"]+)"/);
      if (!timestampMatch) continue;
      
      const timestamp = timestampMatch[1];
      
      // Extract username
      const usernameMatch = messageContent.match(/<div class="from_name">\s*([^<]+)\s*<\/div>/);
      if (!usernameMatch) continue;
      
      const username = usernameMatch[1].toLowerCase().trim();
      
      // Skip excluded users
      if (EXCLUDED_USERS.some(excluded => username.includes(excluded))) {
        continue;
      }
      
      // Extract message text
      const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (!textMatch) continue;
      
      const messageText = textMatch[1];
      
      // Look for token addresses
      const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
      const evmAddressRegex = /0x[a-fA-F0-9]{40}/g;
      
      const solanaMatches = messageText.match(solanaAddressRegex) || [];
      const evmMatches = messageText.match(evmAddressRegex) || [];
      
      // If we found addresses, it could be a CA drop
      if (solanaMatches.length > 0 || evmMatches.length > 0) {
        const addresses = [...solanaMatches, ...evmMatches];
        
        for (const address of addresses) {
          // Determine chain based on address format
          let chain = 'solana';
          if (address.startsWith('0x')) {
            chain = 'unknown_evm';
          }
          
          caDrops.push({
            messageId,
            username,
            timestamp,
            address,
            chain,
            messageText: messageText.replace(/<[^>]*>/g, ''), // Strip HTML tags
            file
          });
        }
      }
    }
  }
  
  return caDrops;
}

// Fetch token metadata from Birdeye
async function fetchTokenMetadata(address, chain) {
  try {
    const response = await axios.get('https://public-api.birdeye.so/defi/v3/token/meta-data/single', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'x-chain': chain,
        'accept': 'application/json'
      },
      params: {
        address: address
      }
    });
    
    if (response.data.success && response.data.data) {
      return {
        name: response.data.data.name,
        symbol: response.data.data.symbol,
        decimals: response.data.data.decimals
      };
    }
  } catch (error) {
    console.log(`Failed to fetch metadata for ${address} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  
  return null;
}

// Fetch candles and determine price from candle data
async function fetchPriceFromCandles(mint, chain, timestamp) {
  try {
    // Ensure timestamp is a valid number
    let unixTimestamp;
    if (typeof timestamp === 'number') {
      unixTimestamp = timestamp;
    } else if (timestamp instanceof Date) {
      unixTimestamp = Math.floor(timestamp.getTime() / 1000);
    } else {
      unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
    }
    
    // Calculate time range: 1 hour before and after the call timestamp
    const startTime = unixTimestamp - 3600; // 1 hour before
    const endTime = unixTimestamp + 3600;   // 1 hour after
    
    console.log(`Fetching candles for ${mint} from ${startTime} to ${endTime}`);
    
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/ohlcv`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address: mint,
        type: '5m',
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: startTime,
        time_to: endTime,
        mode: 'range',
        padding: true,
        outlier: true
      }
    });

    if (response.data.success && response.data.data?.items?.length > 0) {
      const candles = response.data.data.items;
      
      // Find the candle closest to the call timestamp
      let closestCandle = candles[0];
      let minTimeDiff = Math.abs(closestCandle.unix_time - unixTimestamp);
      
      for (const candle of candles) {
        const timeDiff = Math.abs(candle.unix_time - unixTimestamp);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestCandle = candle;
        }
      }
      
      // Use the open price of the closest candle as the call price
      return {
        price: closestCandle.o,
        marketCap: closestCandle.v * closestCandle.c, // volume * close price approximation
        candleTime: closestCandle.unix_time
      };
    }
  } catch (error) {
    console.log(`Failed to fetch candles for ${mint} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  
  return null;
}

// Main function
async function main() {
  console.log('🔍 Extracting CA drops from chat history...');
  
  const caDrops = extractCADrops();
  console.log(`Found ${caDrops.length} potential CA drops`);
  
  // Group by address to avoid duplicates
  const uniqueDrops = new Map();
  caDrops.forEach(drop => {
    const key = `${drop.address}_${drop.username}`;
    if (!uniqueDrops.has(key) || new Date(drop.timestamp) > new Date(uniqueDrops.get(key).timestamp)) {
      uniqueDrops.set(key, drop);
    }
  });
  
  const uniqueCAArray = Array.from(uniqueDrops.values());
  console.log(`Unique CA drops: ${uniqueCAArray.length}`);
  
  // Show first few examples
  console.log('\n📋 Sample CA drops found:');
  uniqueCAArray.slice(0, 5).forEach((drop, index) => {
    console.log(`${index + 1}. ${drop.username}: ${drop.address} (${drop.timestamp})`);
  });
  
  // Fetch metadata for each unique CA drop
  const results = [];
  for (const drop of uniqueCAArray) {
    console.log(`\n📊 Processing: ${drop.address} by ${drop.username}`);
    
    let metadata = null;
    let finalChain = drop.chain;
    
    // For EVM addresses, try different chains
    if (drop.chain === 'unknown_evm') {
      const evmChains = ['bsc', 'ethereum', 'base'];
      for (const chain of evmChains) {
        metadata = await fetchTokenMetadata(drop.address, chain);
        if (metadata) {
          finalChain = chain;
          break;
        }
      }
    } else {
      // For Solana addresses
      metadata = await fetchTokenMetadata(drop.address, 'solana');
    }
    
    if (metadata) {
      // Now fetch price from candles
      const priceData = await fetchPriceFromCandles(drop.address, finalChain, parseTimestamp(drop.timestamp));
      
      results.push({
        ...drop,
        chain: finalChain,
        metadata,
        priceData,
        timestamp: parseTimestamp(drop.timestamp)
      });
      
      console.log(`✅ Found: ${metadata.name} (${metadata.symbol}) on ${finalChain}`);
      if (priceData) {
        console.log(`   Price: $${priceData.price?.toFixed(8) || 'N/A'}, MarketCap: $${priceData.marketCap?.toFixed(2) || 'N/A'}`);
      } else {
        console.log(`   Price: N/A, MarketCap: N/A`);
      }
    } else {
      console.log(`❌ No metadata found for ${drop.address}`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Save results to database
  await saveToDatabase(results);
  
  // Save results to JSON file
  const outputFile = './extracted_ca_drops.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n🎉 Extraction complete! Found ${results.length} CA drops with metadata`);
  console.log(`📁 Results saved to: ${outputFile}`);
  console.log(`💾 Results saved to database`);
  
  // Display summary
  const chainStats = {};
  results.forEach(drop => {
    chainStats[drop.chain] = (chainStats[drop.chain] || 0) + 1;
  });
  
  console.log('\n📊 Chain distribution:');
  Object.entries(chainStats).forEach(([chain, count]) => {
    console.log(`  ${chain}: ${count} tokens`);
  });
}

// Run the extraction
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractCADrops, fetchTokenMetadata };
