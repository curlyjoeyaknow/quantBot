const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose(); // SQLite library in verbose mode for better debug/info

// Configuration
const MESSAGES_DIR = './messages'; // Directory containing all message HTML files
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || ''; // API key for Birdeye (from env or empty string)
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb']; // Usernames to exclude from processing

// Parse timestamp from HTML format (handles multiple quirks in formats)
function parseTimestamp(timestampStr) {
  try {
    // Typical input: "22.10.2025 11:38:15 UTC+10:00"
    // Split into [date, time, timezone] parts
    const parts = timestampStr.split(' ');
    if (parts.length >= 2) {
      const datePart = parts[0]; // e.g. "22.10.2025"
      const timePart = parts[1]; // e.g. "11:38:15"
      const timezonePart = parts[2]; // e.g. "UTC+10:00"
      
      // Break date up into day/month/year components
      const dateComponents = datePart.split('.');
      if (dateComponents.length === 3) {
        const day = dateComponents[0];
        const month = dateComponents[1];
        const year = dateComponents[2];
        
        // Build ISO string suitable for JS Date parsing
        const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`;

        // Convert Telegram's "UTC+XX:YY" to "+XX:YY"
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
    
    // Fallback: regex replace to "+/-", then parse
    let cleanTimestamp = timestampStr;
    cleanTimestamp = cleanTimestamp.replace(/UTC\+(\d{2}):(\d{2})/g, '+$1:$2');
    cleanTimestamp = cleanTimestamp.replace(/UTC\-(\d{2}):(\d{2})/g, '-$1:$2');
    
    const date = new Date(cleanTimestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    
    // If parsing failed, warn and return current time
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date().toISOString();
    
  } catch (error) {
    // Catch-all in case of totally unhandled format or other error
    console.warn(`Error parsing timestamp ${timestampStr}:`, error.message);
    return new Date().toISOString();
  }
}

// Save extracted CA drops to database
async function saveToDatabase(results) {
  // Promisified flow for database operations
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./simulations.db', (err) => {
      if (err) {
        // Could not connect to DB
        console.error('Error connecting to database:', err);
        reject(err);
        return;
      }
    });

    // Prepare upsert statement; ignores duplicates by unique constraint
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO ca_calls 
      (mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, caller, source_chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let savedCount = 0;    // Counter for saved rows
    let skippedCount = 0;  // Counter for skipped rows (existing)

    db.serialize(() => {
      db.run('BEGIN TRANSACTION;'); // Use transaction for efficiency
      
      results.forEach(drop => {
        const userId = 1; // Not used, placeholder for possible future use
        const chatId = 1; // All come from the same chat, set statically
        const callTimestamp = Math.floor(new Date(drop.timestamp).getTime() / 1000); // UNIX seconds
        const defaultStrategy = JSON.stringify([
          { percent: 0.5, target: 2 },
          { percent: 0.3, target: 5 },
          { percent: 0.2, target: 10 }
        ]);
        const defaultStopLoss = JSON.stringify({ initial: -0.5, trailing: 0.5 }); // For future

        // Save data. Changes > 0: new row. 0: duplicate/skip.
        insertStmt.run(
          drop.address,                // Token CA
          drop.chain,                  // Blockchain chain
          drop.metadata.name,          // Token name
          drop.metadata.symbol,        // Token symbol
          drop.priceData?.price || 0,  // Extracted price at call time
          drop.priceData?.marketCap || 0, // Extracted marketcap at call time
          callTimestamp,               // UNIX timestamp of the call
          drop.caller,                 // Username of the caller
          chatId,                      // Telegram chat ID (static here)
          function(err) {
            if (err) {
              // Error inserting this record
              console.error('Error inserting CA drop:', err);
              skippedCount++;
            } else {
              // Only increments if this is a new row due to "INSERT OR IGNORE"
              if (this.changes > 0) {
                savedCount++;
              } else {
                skippedCount++; // Was already present in table
              }
            }
          }
        );
      });

      db.run('COMMIT;', (err) => {
        if (err) {
          // Database commit failure
          console.error('Error committing transaction:', err);
          reject(err);
        } else {
          // The transaction and insertions are done
          console.log(`📊 Database save complete: ${savedCount} new, ${skippedCount} skipped (already exists)`);
          insertStmt.finalize();
          db.close();
          resolve();
        }
      });
    });
  });
}

// Extract possible CA drops from Telegram-exported HTML
function extractCADrops() {
  const caDrops = [];
  // List/scan all relevant files in the message directory
  const files = fs.readdirSync(MESSAGES_DIR)
    .filter(file => file.startsWith('messages') && file.endsWith('.html')) // Only Telegram HTMLs
    .sort((a, b) => {
      // Sort descending by number in filename, so most recent first
      const numA = parseInt(a.match(/messages(\d+)\.html/)?.[1] || '0');
      const numB = parseInt(b.match(/messages(\d+)\.html/)?.[1] || '0');
      return numB - numA;
    });

  console.log(`Found ${files.length} message files`);

  // Limit: only process a single slice for this run (slice(2,3))
  const filesToProcess = files.slice(2, 3); // Only process specific file(s) as an example
  console.log(`Processing ${filesToProcess.length} file(s) for CA extraction...`);
  
  for (const file of filesToProcess) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(MESSAGES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Regex to extract each individual message block (by div)
    const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)(?=<div class="message|$)/g;
    let match;
    let processedCount = 0;
    const maxPerFile = 50; // Don't process more than this many drops per file to be safe
    
    while ((match = messageRegex.exec(content)) !== null && processedCount < maxPerFile) {
      const messageId = match[1];      // Telegram message numerical ID
      const messageContent = match[2]; // HTML for single message

      // Extract message timestamp from title attribute
      const timestampMatch = messageContent.match(/title="([^"]+)"/);
      if (!timestampMatch) continue;
      const timestamp = timestampMatch[1];
      
      // Extract username (from_name block)
      const usernameMatch = messageContent.match(/<div class="from_name">\s*([^<]+)\s*<\/div>/);
      if (!usernameMatch) continue;
      const username = usernameMatch[1].toLowerCase().trim();
      
      // Skip any excluded usernames (case insensitive substring match)
      if (EXCLUDED_USERS.some(excluded => username.includes(excluded))) {
        continue;
      }
      
      // Get the body text. Telegram often wraps plain chat in <div class="text">
      const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (!textMatch) continue;
      const messageText = textMatch[1];
      
      // Search for token addresses in Solana and EVM formats
      const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g; // Base58, 32-44 chars (no 0IOl)
      const evmAddressRegex = /0x[a-fA-F0-9]{40}/g;             // 0x-prefixed 40-hex (EVM chains)
      const solanaMatches = messageText.match(solanaAddressRegex) || [];
      const evmMatches = messageText.match(evmAddressRegex) || [];
      
      // If either Solana or EVM address found, add all as CA drops
      if (solanaMatches.length > 0 || evmMatches.length > 0) {
        const addresses = [...solanaMatches, ...evmMatches];
        for (const address of addresses) {
          // Mark probable chain type
          let chain = 'solana';
          if (address.startsWith('0x')) {
            chain = 'unknown_evm'; // We'll probe for specific EVM below
          }
          caDrops.push({
            messageId,
            username,
            timestamp,
            address,
            chain,
            messageText: messageText.replace(/<[^>]*>/g, ''), // Remove any HTML tags from text
            file
          });
        }
      }
    }
  }
  
  return caDrops;
}

// Request token metadata (name, symbol, decimals) from Birdeye for a given chain/address
async function fetchTokenMetadata(address, chain) {
  try {
    const response = await axios.get('https://public-api.birdeye.so/defi/v3/token/meta-data/single', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,           // Auth for Birdeye
        'x-chain': chain,                       // Chain: solana/bsc/ethereum/etc
        'accept': 'application/json'
      },
      params: {
        address: address                        // Token CA
      }
    });
    // Check Birdeye response for result
    if (response.data.success && response.data.data) {
      return {
        name: response.data.data.name,
        symbol: response.data.data.symbol,
        decimals: response.data.data.decimals
      };
    }
  } catch (error) {
    // Print error from API or http
    console.log(`Failed to fetch metadata for ${address} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  // Nothing found or request failed
  return null;
}

// Query Birdeye candle endpoint, find price/MC for the call timestamp
async function fetchPriceFromCandles(mint, chain, timestamp) {
  try {
    // Normalize timestamp to UNIX seconds (accepts Date/number/ISO)
    let unixTimestamp;
    if (typeof timestamp === 'number') {
      unixTimestamp = timestamp;
    } else if (timestamp instanceof Date) {
      unixTimestamp = Math.floor(timestamp.getTime() / 1000);
    } else {
      unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
    }
    
    // Request 1 hour before/after the call time for context
    const startTime = unixTimestamp - 3600; // 1 hour earlier
    const endTime = unixTimestamp + 3600;   // 1 hour later
    
    console.log(`Fetching candles for ${mint} from ${startTime} to ${endTime}`);
    
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/ohlcv`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address: mint,
        type: '5m',                 // 5-minute OHLCV intervals
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: startTime,
        time_to: endTime,
        mode: 'range',
        padding: true,
        outlier: true
      }
    });

    // Check response, locate closest candle, return its values
    if (response.data.success && response.data.data?.items?.length > 0) {
      const candles = response.data.data.items;
      // Find candle closest in time to unixTimestamp
      let closestCandle = candles[0];
      let minTimeDiff = Math.abs(closestCandle.unix_time - unixTimestamp);
      for (const candle of candles) {
        const timeDiff = Math.abs(candle.unix_time - unixTimestamp);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestCandle = candle;
        }
      }
      // Use the opening price of that candle as our "call" price
      return {
        price: closestCandle.o,
        marketCap: closestCandle.v * closestCandle.c, // Approx MC: volume * close price
        candleTime: closestCandle.unix_time
      };
    }
  } catch (error) {
    // Print out HTTP/API error
    console.log(`Failed to fetch candles for ${mint} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  // Nothing found
  return null;
}

// Main function: orchestrates extraction, metadata, price, and DB save
async function main() {
  console.log('🔍 Extracting CA drops from chat history...');
  
  const caDrops = extractCADrops(); // Step 1: Find all possible CAs in exports
  console.log(`Found ${caDrops.length} potential CA drops`);
  
  // Group and deduplicate drops by address+username. Only latest call kept.
  const uniqueDrops = new Map();
  caDrops.forEach(drop => {
    const key = `${drop.address}_${drop.username}`;
    if (!uniqueDrops.has(key) || new Date(drop.timestamp) > new Date(uniqueDrops.get(key).timestamp)) {
      uniqueDrops.set(key, drop);
    }
  });
  
  const uniqueCAArray = Array.from(uniqueDrops.values());
  console.log(`Unique CA drops: ${uniqueCAArray.length}`);
  
  // Print sample results as a spot-check
  console.log('\n📋 Sample CA drops found:');
  uniqueCAArray.slice(0, 5).forEach((drop, index) => {
    console.log(`${index + 1}. ${drop.username}: ${drop.address} (${drop.timestamp})`);
  });
  
  // For each drop: fill in metadata/price, then add to results
  const results = [];
  for (const drop of uniqueCAArray) {
    console.log(`\n📊 Processing: ${drop.address} by ${drop.username}`);
    let metadata = null;
    let finalChain = drop.chain;

    // If EVM, try each chain in turn until we get metadata
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
      // Otherwise, assume Solana
      metadata = await fetchTokenMetadata(drop.address, 'solana');
    }
    
    if (metadata) {
      // Now that we have metadata, get historical price/MC from Birdeye
      const priceData = await fetchPriceFromCandles(
        drop.address,
        finalChain,
        parseTimestamp(drop.timestamp)
      );
      results.push({
        ...drop,
        chain: finalChain,
        metadata,
        priceData,
        timestamp: parseTimestamp(drop.timestamp)
      });
      console.log(`✅ Found: ${metadata.name} (${metadata.symbol}) on ${finalChain}`);
      if (priceData) {
        console.log(
          `   Price: $${priceData.price?.toFixed(8) || 'N/A'}, MarketCap: $${priceData.marketCap?.toFixed(2) || 'N/A'}`
        );
      } else {
        console.log(`   Price: N/A, MarketCap: N/A`);
      }
    } else {
      // Could not get metadata: not on any chain checked, or request failed
      console.log(`❌ No metadata found for ${drop.address}`);
    }
    // Rate limiting: sleep 100ms between API batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Save all outputs to DB and to disk
  await saveToDatabase(results);
  
  // Also persist to JSON (for backup/inspection)
  const outputFile = './extracted_ca_drops.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n🎉 Extraction complete! Found ${results.length} CA drops with metadata`);
  console.log(`📁 Results saved to: ${outputFile}`);
  console.log(`💾 Results saved to database`);
  
  // Print distribution of tokens by chain as a summary
  const chainStats = {};
  results.forEach(drop => {
    chainStats[drop.chain] = (chainStats[drop.chain] || 0) + 1;
  });
  
  console.log('\n📊 Chain distribution:');
  Object.entries(chainStats).forEach(([chain, count]) => {
    console.log(`  ${chain}: ${count} tokens`);
  });
}

// Run if called as script, not if required as module
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractCADrops, fetchTokenMetadata };
