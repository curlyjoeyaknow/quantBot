const fs = require('fs'); // Node file system module
const path = require('path'); // Path utility
const axios = require('axios'); // HTTP client for API requests

// Configuration
const BROOK_DIR = './messages/brook'; // Directory where Brook HTML messages are located
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || ''; // Birdeye API key from environment, fallback to empty string
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb']; // Usernames to exclude from CA extraction

// Attempt to parse timestamp from the HTML message's format.
// Handles formats like "22.10.2025 11:38:15 UTC+10:00".
function parseTimestamp(timestampStr) {
  try {
    // Example: "22.10.2025 11:38:15 UTC+10:00"
    const parts = timestampStr.split(' ');
    if (parts.length >= 2) {
      const datePart = parts[0]; // e.g., "22.10.2025"
      const timePart = parts[1]; // e.g., "11:38:15"
      const timezonePart = parts[2]; // e.g., "UTC+10:00"

      // Split date into day, month, year
      const dateComponents = datePart.split('.');
      if (dateComponents.length === 3) {
        const day = dateComponents[0];
        const month = dateComponents[1];
        const year = dateComponents[2];
        // Compose ISO 8601 string: YYYY-MM-DDTHH:mm:ss (timezone appended shortly)
        const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`;

        // Convert HTML timezone to ISO timezone
        let timezoneOffset = '';
        if (timezonePart) {
          if (timezonePart.includes('UTC+')) {
            timezoneOffset = timezonePart.replace('UTC+', '+');
          } else if (timezonePart.includes('UTC-')) {
            timezoneOffset = timezonePart.replace('UTC-', '-');
          }
          // If missing UTC+/- then timezone stays empty
        }

        // Concatenate full timestamp ("YYYY-MM-DDTHH:mm:ss+/-HH:MM")
        const fullTimestamp = isoString + timezoneOffset;
        const date = new Date(fullTimestamp);

        if (!isNaN(date.getTime())) {
          // If valid date, return ISO encoding in UTC
          return date.toISOString();
        }
      }
    }

    // Fallback: try native Date parsing (may work for unanticipated cases)
    const fallbackDate = new Date(timestampStr);
    if (!isNaN(fallbackDate.getTime())) {
      return fallbackDate.toISOString();
    }
  } catch (error) {
    // Warn but don't crash
    console.log(`Error parsing timestamp "${timestampStr}": ${error.message}`);
  }

  return null; // Indicate failure to parse
}

// Extract CA drops (token contract address drops) from HTML content
function extractCADrops(content) {
  const drops = [];
  // Regex for matching each Telegram message block  
  const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)(?=<div class="message|$)/g;
  let match;

  // Iterate over all matched messages in the HTML file
  while ((match = messageRegex.exec(content)) !== null) {
    const messageId = match[1]; // Extracted message ID
    const messageContent = match[2]; // Raw HTML chunk for this message

    // Extract "from name" (sender username/display name)
    const senderMatch = messageContent.match(/<div class="from_name">([^<]+)<\/div>/);
    if (!senderMatch) continue;

    const sender = senderMatch[1].trim();

    // Skip if sender appears in the EXCLUDED_USERS list, by case-insensitive substring
    if (EXCLUDED_USERS.some(excluded => sender.toLowerCase().includes(excluded.toLowerCase()))) {
      continue;
    }

    // Extract timestamp string from message block (title attribute)
    const timestampMatch = messageContent.match(/<div class="pull_right date details" title="([^"]+)"/);
    if (!timestampMatch) continue;

    const timestampStr = timestampMatch[1]; // Raw timestamp string
    const timestamp = parseTimestamp(timestampStr);
    if (!timestamp) continue; // Only process messages with valid timestamps

    // Grab the message text div content (may contain HTML tags)
    const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
    if (!textMatch) continue;

    const messageText = textMatch[1];

    // Find all contract addresses in the message text:
    // Solana: base58 (32-44 chars)
    const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g; // Common for Solana CAs
    const solanaMatches = messageText.match(solanaRegex);

    // ETH/BSC: 0x prefix + 40 hex characters
    const ethRegex = /0x[a-fA-F0-9]{40}/g;
    const ethMatches = messageText.match(ethRegex);

    // Combine all found addresses (could be both types in same message, rare but possible)
    const allMatches = [...(solanaMatches || []), ...(ethMatches || [])];

    for (const address of allMatches) {
      // Weed out extremely short matches (false positives)
      if (address.length < 32) continue;

      // Record the CA drop with context:
      drops.push({
        messageId,
        sender,
        timestamp,
        address,
        messageText: messageText.replace(/<[^>]*>/g, '').trim(), // Remove any HTML tags
        rawTimestamp: timestampStr // For reference/debug
      });
    }
  }

  return drops; // Array of extracted CA drops with metadata
}

// Fetch token metadata (name, symbol, decimals) from Birdeye API
async function fetchTokenMetadata(address, chain = 'solana') {
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/v3/token/meta-data/single`,
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: { address: address }
      }
    );

    // Success: return a smaller metadata object (handle nulls, fail silently if needed)
    if (response.data.success) {
      return {
        name: response.data.data.name,
        symbol: response.data.data.symbol,
        decimals: response.data.data.decimals
      };
    }
  } catch (error) {
    // Print API errors, if any (helpful for debugging)
    console.log(`Failed to fetch metadata for ${address} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  return null;
}

// For a CA at a given timestamp, fetch on-chain price and market cap data (via Birdeye candles)
async function fetchPriceFromCandles(mint, chain, unixTimestamp) {
  try {
    // Create JS Date objects (one hour range around the call time, for robust candle matching)
    const callTime = new Date(unixTimestamp * 1000);
    const startTime = new Date(callTime.getTime() - 60 * 60 * 1000); // 1 hour before
    const endTime = new Date(callTime.getTime() + 60 * 60 * 1000);   // 1 hour after

    // Query Birdeye OHLCV endpoint for this CA & time window
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/v3/ohlcv`,
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: {
          address: mint,
          type: '5m', // Candle interval
          currency: 'usd',
          ui_amount_mode: 'raw',
          time_from: Math.floor(startTime.getTime() / 1000), // seconds
          time_to: Math.floor(endTime.getTime() / 1000),     // seconds
          mode: 'range',
          padding: true // Add candles if data is sparse
        }
      }
    );

    // Presence and structure check on returned data
    if (response.data.success && response.data.data.items && response.data.data.items.length > 0) {
      const candles = response.data.data.items;

      // Find candle closest to unixTimestamp (not necessarily exact match)
      let closestCandle = candles[0];
      let minTimeDiff = Math.abs(closestCandle.unix_time - unixTimestamp);

      for (const candle of candles) {
        const timeDiff = Math.abs(candle.unix_time - unixTimestamp);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestCandle = candle;
        }
      }

      // Return open price and estimated marketcap (volume x open)
      return {
        price: closestCandle.open,
        marketCap: closestCandle.volume * closestCandle.open
      };
    }
  } catch (error) {
    // If candles fetch or API is failing, log error only (do not interrupt flow)
    console.log(`Failed to fetch candles for ${mint} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  return null; // Not found / error, proceed with null
}

// Convert array of output records to CSV text
function convertToCSV(results) {
  const headers = [
    'Message ID',
    'Sender',
    'Timestamp',
    'Raw Timestamp',
    'Address',
    'Chain',
    'Token Name',
    'Token Symbol',
    'Decimals',
    'Call Price',
    'Market Cap',
    'Message Text'
  ];

  const csvRows = [headers.join(',')];

  // Loop through extracted records, format as CSV line
  for (const result of results) {
    const row = [
      `"${result.messageId}"`,
      `"${result.sender}"`,
      `"${result.timestamp}"`,
      `"${result.rawTimestamp}"`,
      `"${result.address}"`,
      `"${result.chain}"`,
      `"${result.metadata?.name || 'N/A'}"`,
      `"${result.metadata?.symbol || 'N/A'}"`,
      `"${result.metadata?.decimals || 'N/A'}"`,
      `"${result.priceData?.price || 'N/A'}"`,
      `"${result.priceData?.marketCap || 'N/A'}"`,
      `"${result.messageText.replace(/"/g, '""')}"` // Double up quotes inside message
    ];
    csvRows.push(row.join(','));
  }

  return csvRows.join('\n');
}

// Main execution: processes all Brook HTML files, extracting CA drops to CSV
async function processBrookMessages() {
  console.log('🔍 Processing Brook messages for CA extraction...');

  // Load HTML filenames from the brook directory
  const files = fs.readdirSync(BROOK_DIR).filter(file => file.endsWith('.html'));
  console.log(`Found ${files.length} HTML files in brook directory:`, files);

  const allResults = []; // Will collect all processed CA drops

  for (const file of files) {
    console.log(`\n📄 Processing ${file}...`);
    const filePath = path.join(BROOK_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8'); // Read file contents

    // Extract all CAs from the file's content
    const drops = extractCADrops(content);
    console.log(`Found ${drops.length} potential CA drops in ${file}`);

    // Limit: for quick runs & API friendliness, only process first 5 per file
    const limitedDrops = drops.slice(0, 5);
    console.log(`Processing first ${limitedDrops.length} drops from ${file} (TESTING MODE)`);

    for (const drop of limitedDrops) {
      console.log(`\n🔍 Processing CA drop: ${drop.address}`);
      console.log(`   Sender: ${drop.sender}`);
      console.log(`   Timestamp: ${drop.timestamp}`);

      // Decide blockchain by address prefix (solana = base58, eth/bsc = '0x')
      let chain = 'solana';
      if (drop.address.startsWith('0x')) {
        chain = 'ethereum'; // Try ETH first; fallback to BSC if ETH fails
      }

      // Try fetching the metadata for this address/chain
      let metadata = await fetchTokenMetadata(drop.address, chain);

      // If not found and looks like Ethereum (0x...), try on BSC instead
      if (!metadata && drop.address.startsWith('0x')) {
        console.log(`   Trying BSC for address ${drop.address}`);
        chain = 'bsc';
        metadata = await fetchTokenMetadata(drop.address, chain);
      }

      if (metadata) {
        console.log(`   ✅ Found token: ${metadata.name} (${metadata.symbol}) on ${chain}`);

        // Get price/marketcap at the call timestamp (nearest 5m candle)
        const unixTimestamp = Math.floor(new Date(drop.timestamp).getTime() / 1000);
        const priceData = await fetchPriceFromCandles(drop.address, chain, unixTimestamp);

        if (priceData) {
          console.log(`   💰 Price: $${priceData.price}, Market Cap: $${priceData.marketCap}`);
        } else {
          console.log(`   ⚠️  Could not fetch price data`);
        }

        allResults.push({
          ...drop,
          chain,
          metadata,
          priceData
        });
      } else {
        // If we couldn't get metadata (unknown CA, or on a wrong chain)
        console.log(`   ❌ Token not found on ${chain}`);
        allResults.push({
          ...drop,
          chain,
          metadata: null,
          priceData: null
        });
      }

      // Add a brief delay between API requests to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n📊 Total CA drops processed: ${allResults.length}`);

  // Transform results and save to a CSV file (one per date)
  const csvContent = convertToCSV(allResults);
  const csvFileName = `brook_ca_drops_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(csvFileName, csvContent);

  // Print summary analysis: counts, breakdowns by chain and sender, etc.
  console.log(`\n✅ CSV file saved as: ${csvFileName}`);
  console.log(`📈 Summary:`);
  console.log(`   • Total drops: ${allResults.length}`);
  console.log(`   • With metadata: ${allResults.filter(r => r.metadata).length}`);
  console.log(`   • With price data: ${allResults.filter(r => r.priceData).length}`);
  console.log(`   • Chains: ${[...new Set(allResults.map(r => r.chain))].join(', ')}`);
  console.log(`   • Senders: ${[...new Set(allResults.map(r => r.sender))].join(', ')}`);

  return allResults;
}

// Run script directly: trigger processing if run as main
if (require.main === module) {
  processBrookMessages().catch(console.error);
}

// Export function for external use, e.g., in tests or other scripts
module.exports = { processBrookMessages };
