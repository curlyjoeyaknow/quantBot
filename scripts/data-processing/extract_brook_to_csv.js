const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const BROOK_DIR = './messages/brook';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb']; // Exclude these users as requested

// Parse timestamp from HTML format
function parseTimestamp(timestampStr) {
  try {
    // Handle formats like "22.10.2025 11:38:15 UTC+10:00"
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
    
    // Fallback: try direct parsing
    const fallbackDate = new Date(timestampStr);
    if (!isNaN(fallbackDate.getTime())) {
      return fallbackDate.toISOString();
    }
  } catch (error) {
    console.log(`Error parsing timestamp "${timestampStr}": ${error.message}`);
  }
  
  return null;
}

// Extract CA drops from message content
function extractCADrops(content) {
  const drops = [];
  
  // Find all message blocks using regex
  const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)(?=<div class="message|$)/g;
  let match;
  
  while ((match = messageRegex.exec(content)) !== null) {
    const messageId = match[1];
    const messageContent = match[2];
    
    // Extract sender name
    const senderMatch = messageContent.match(/<div class="from_name">([^<]+)<\/div>/);
    if (!senderMatch) continue;
    
    const sender = senderMatch[1].trim();
    
    // Skip excluded users
    if (EXCLUDED_USERS.some(excluded => sender.toLowerCase().includes(excluded.toLowerCase()))) {
      continue;
    }
    
    // Extract timestamp
    const timestampMatch = messageContent.match(/<div class="pull_right date details" title="([^"]+)"/);
    if (!timestampMatch) continue;
    
    const timestampStr = timestampMatch[1];
    const timestamp = parseTimestamp(timestampStr);
    if (!timestamp) continue;
    
    // Extract message text
    const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
    if (!textMatch) continue;
    
    const messageText = textMatch[1];
    
    // Look for contract addresses in the message
    // Solana addresses (base58, typically 32-44 characters)
    const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const solanaMatches = messageText.match(solanaRegex);
    
    // Ethereum/BSC addresses (0x followed by 40 hex characters)
    const ethRegex = /0x[a-fA-F0-9]{40}/g;
    const ethMatches = messageText.match(ethRegex);
    
    // Combine all matches
    const allMatches = [...(solanaMatches || []), ...(ethMatches || [])];
    
    for (const address of allMatches) {
      // Skip very short matches that are likely not addresses
      if (address.length < 32) continue;
      
      drops.push({
        messageId,
        sender,
        timestamp,
        address,
        messageText: messageText.replace(/<[^>]*>/g, '').trim(), // Remove HTML tags
        rawTimestamp: timestampStr
      });
    }
  }
  
  return drops;
}

// Fetch token metadata from Birdeye
async function fetchTokenMetadata(address, chain = 'solana') {
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address: address
      }
    });

    if (response.data.success) {
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

// Fetch price from candles
async function fetchPriceFromCandles(mint, chain, unixTimestamp) {
  try {
    const callTime = new Date(unixTimestamp * 1000);
    const startTime = new Date(callTime.getTime() - 60 * 60 * 1000); // 1 hour before
    const endTime = new Date(callTime.getTime() + 60 * 60 * 1000);   // 1 hour after
    
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
        time_from: Math.floor(startTime.getTime() / 1000),
        time_to: Math.floor(endTime.getTime() / 1000),
        mode: 'range',
        padding: true
      }
    });

    if (response.data.success && response.data.data.items && response.data.data.items.length > 0) {
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

      return {
        price: closestCandle.open, // Using open price of the closest candle
        marketCap: closestCandle.volume * closestCandle.open // Estimate market cap from volume and open price
      };
    }
  } catch (error) {
    console.log(`Failed to fetch candles for ${mint} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  return null;
}

// Convert results to CSV format
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
      `"${result.messageText.replace(/"/g, '""')}"` // Escape quotes in message text
    ];
    csvRows.push(row.join(','));
  }
  
  return csvRows.join('\n');
}

// Main processing function
async function processBrookMessages() {
  console.log('🔍 Processing Brook messages for CA extraction...');
  
  // Get all HTML files in brook directory
  const files = fs.readdirSync(BROOK_DIR).filter(file => file.endsWith('.html'));
  console.log(`Found ${files.length} HTML files in brook directory:`, files);
  
  const allResults = [];
  
  for (const file of files) {
    console.log(`\n📄 Processing ${file}...`);
    const filePath = path.join(BROOK_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const drops = extractCADrops(content);
    console.log(`Found ${drops.length} potential CA drops in ${file}`);
    
    // Limit processing to first 5 drops per file for testing
    const limitedDrops = drops.slice(0, 5);
    console.log(`Processing first ${limitedDrops.length} drops from ${file} (TESTING MODE)`);
    
    for (const drop of limitedDrops) {
      console.log(`\n🔍 Processing CA drop: ${drop.address}`);
      console.log(`   Sender: ${drop.sender}`);
      console.log(`   Timestamp: ${drop.timestamp}`);
      
      // Determine chain based on address format
      let chain = 'solana';
      if (drop.address.startsWith('0x')) {
        chain = 'ethereum'; // Try ethereum first, then bsc if that fails
      }
      
      // Fetch token metadata
      let metadata = await fetchTokenMetadata(drop.address, chain);
      
      // If ethereum failed, try BSC for 0x addresses
      if (!metadata && drop.address.startsWith('0x')) {
        console.log(`   Trying BSC for address ${drop.address}`);
        chain = 'bsc';
        metadata = await fetchTokenMetadata(drop.address, chain);
      }
      
      if (metadata) {
        console.log(`   ✅ Found token: ${metadata.name} (${metadata.symbol}) on ${chain}`);
        
        // Fetch price data from candles
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
        console.log(`   ❌ Token not found on ${chain}`);
        // Still add to results but with null metadata
        allResults.push({
          ...drop,
          chain,
          metadata: null,
          priceData: null
        });
      }
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`\n📊 Total CA drops processed: ${allResults.length}`);
  
  // Convert to CSV and save
  const csvContent = convertToCSV(allResults);
  const csvFileName = `brook_ca_drops_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(csvFileName, csvContent);
  
  console.log(`\n✅ CSV file saved as: ${csvFileName}`);
  console.log(`📈 Summary:`);
  console.log(`   • Total drops: ${allResults.length}`);
  console.log(`   • With metadata: ${allResults.filter(r => r.metadata).length}`);
  console.log(`   • With price data: ${allResults.filter(r => r.priceData).length}`);
  console.log(`   • Chains: ${[...new Set(allResults.map(r => r.chain))].join(', ')}`);
  console.log(`   • Senders: ${[...new Set(allResults.map(r => r.sender))].join(', ')}`);
  
  return allResults;
}

// Run the processing
if (require.main === module) {
  processBrookMessages().catch(console.error);
}

module.exports = { processBrookMessages };
