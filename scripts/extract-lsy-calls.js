const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');

// Configuration
const MESSAGES_DIR = path.join(__dirname, '../data/raw/messages');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/csv');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'lsy_calls.csv');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Parse timestamp from Telegram message
 */
function parseTelegramTimestamp(timestampStr) {
  try {
    // Handle Telegram format: "03.10.2025 12:52:12 UTC+10:00"
    if (timestampStr.includes('UTC')) {
      const match = timestampStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, day, month, year, hour, minute, second] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
        return date;
      }
    }
    
    // Handle other formats
    const cleanTimestamp = timestampStr.replace(/[^\d\s:\-\.\/APMUTC]/g, '');
    
    // Try different timestamp formats
    const formats = [
      /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[·@]\s*(\d{1,2})\/(\d{1,2})\s*UTC/i,
      /(\d{1,2}):(\d{2})\s*@\s*(\d{1,2})-(\d{1,2})\s*UTC/i,
      /(\d{1,2}):(\d{2})\s*[·@]\s*(\d{1,2})\/(\d{1,2})\s*UTC/i
    ];
    
    for (const format of formats) {
      const match = cleanTimestamp.match(format);
      if (match) {
        let hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        let month, day;
        
        if (match[3] && match[3].match(/AM|PM/i)) {
          // Format: "09:00 AM · 10/3 UTC"
          const ampm = match[3].toUpperCase();
          month = parseInt(match[4]);
          day = parseInt(match[5]);
          
          if (ampm === 'PM' && hour !== 12) hour += 12;
          if (ampm === 'AM' && hour === 12) hour = 0;
        } else {
          // Format: "07:25 @ 03-10 UTC" or "09:00 · 10/3 UTC"
          month = parseInt(match[3] || match[4]);
          day = parseInt(match[4] || match[5]);
        }
        
        // Assume current year (you might want to adjust this)
        const year = new Date().getFullYear();
        const date = new Date(year, month - 1, day, hour, minute);
        
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    return new Date('Invalid Date');
  } catch (error) {
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date('Invalid Date');
  }
}

/**
 * Extract token address from message text
 */
function extractTokenAddress(text) {
  // Look for common token address patterns
  const patterns = [
    /0x[a-fA-F0-9]{40}/g,  // Ethereum/BSC addresses
    /[1-9A-HJ-NP-Za-km-z]{32,44}/g  // Solana addresses
  ];
  
  const addresses = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      addresses.push(...matches);
    }
  }
  
  return addresses;
}

/**
 * Extract token symbol/name from message text
 */
function extractTokenInfo(text) {
  // Look for token symbols in various formats
  const symbolPatterns = [
    /🪙\s*Token:\s*([^(]+)/i,
    /Token:\s*([^(]+)/i,
    /🪙\s*([^(]+)/i,
    /^([A-Z0-9]+)\s*\[/i,  // Format: "TOKEN [info]"
    /^([A-Z0-9]+)\s*\(/i   // Format: "TOKEN (info)"
  ];
  
  for (const pattern of symbolPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return 'UNKNOWN';
}

/**
 * Determine chain from token address
 */
function determineChain(address) {
  if (address.startsWith('0x') && address.length === 42) {
    return 'bsc'; // Default to BSC for 0x addresses
  } else if (address.length >= 32 && address.length <= 44) {
    return 'solana';
  }
  return 'unknown';
}

/**
 * Process a single HTML message file
 */
function processMessageFile(filePath) {
  console.log(`📄 Processing ${path.basename(filePath)}...`);
  
  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(htmlContent);
  const lsyCalls = [];
  
  // Find all message elements
  $('.message').each((index, element) => {
    const $message = $(element);
    
    // Check if this message is from Lsy♡
    const $fromName = $message.find('.from_name');
    const senderName = $fromName.text().trim();
    
    if (senderName.includes('Lsy♡') || senderName.includes('Lsy')) {
      // Extract timestamp
      const $dateElement = $message.find('.date');
      const timestampStr = $dateElement.attr('title') || $dateElement.text() || '';
      
      // Extract message text
      const $textElement = $message.find('.text');
      const messageText = $textElement.text().trim();
      
      // Extract token addresses
      const tokenAddresses = extractTokenAddress(messageText);
      
      // Extract token info
      const tokenSymbol = extractTokenInfo(messageText);
      
      // Process each token address found
      tokenAddresses.forEach(address => {
        const chain = determineChain(address);
        const timestamp = parseTelegramTimestamp(timestampStr);
        
        if (!isNaN(timestamp.getTime())) {
          lsyCalls.push({
            sender: 'Lsy♡',
            tokenAddress: address,
            tokenSymbol: tokenSymbol,
            chain: chain,
            timestamp: timestamp.toISOString(),
            message: messageText.substring(0, 500), // Truncate long messages
            sourceFile: path.basename(filePath)
          });
        }
      });
    }
  });
  
  console.log(`  ✅ Found ${lsyCalls.length} Lsy calls`);
  return lsyCalls;
}

/**
 * Main extraction function
 */
async function extractLsyCalls() {
  console.log('🚀 Starting Lsy calls extraction from curlyjoe channel...');
  
  try {
    // Get all HTML files
    const files = fs.readdirSync(MESSAGES_DIR)
      .filter(file => file.endsWith('.html'))
      .map(file => path.join(MESSAGES_DIR, file));
    
    console.log(`📁 Found ${files.length} message files to process`);
    
    let allLsyCalls = [];
    
    // Process each file
    for (const file of files) {
      try {
        const calls = processMessageFile(file);
        allLsyCalls.push(...calls);
      } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message);
      }
    }
    
    // Remove duplicates based on token address and timestamp
    const uniqueCalls = allLsyCalls.filter((call, index, self) => 
      index === self.findIndex(c => 
        c.tokenAddress === call.tokenAddress && 
        Math.abs(new Date(c.timestamp).getTime() - new Date(call.timestamp).getTime()) < 60000 // Within 1 minute
      )
    );
    
    console.log(`📊 Total Lsy calls found: ${allLsyCalls.length}`);
    console.log(`📊 Unique Lsy calls: ${uniqueCalls.length}`);
    
    // Sort by timestamp
    uniqueCalls.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Save to CSV
    const csvContent = await new Promise((resolve, reject) => {
      stringify(uniqueCalls, {
        header: true,
        columns: ['sender', 'tokenAddress', 'tokenSymbol', 'chain', 'timestamp', 'message', 'sourceFile']
      }, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
    
    fs.writeFileSync(OUTPUT_FILE, csvContent);
    console.log(`📋 Lsy calls saved to: ${OUTPUT_FILE}`);
    
    // Print summary
    console.log('\n🎉 === LSY CALLS EXTRACTION COMPLETE ===');
    console.log(`📊 Total calls: ${uniqueCalls.length}`);
    console.log(`📊 Unique tokens: ${new Set(uniqueCalls.map(c => c.tokenAddress)).size}`);
    console.log(`📊 Chains: ${Array.from(new Set(uniqueCalls.map(c => c.chain))).join(', ')}`);
    
    if (uniqueCalls.length > 0) {
      const dateRange = {
        start: new Date(Math.min(...uniqueCalls.map(c => new Date(c.timestamp).getTime()))),
        end: new Date(Math.max(...uniqueCalls.map(c => new Date(c.timestamp).getTime())))
      };
      console.log(`📅 Date range: ${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`);
      
      console.log('\n📋 Sample calls:');
      uniqueCalls.slice(0, 5).forEach((call, index) => {
        console.log(`   ${index + 1}. ${call.tokenSymbol} (${call.tokenAddress}) - ${call.chain} - ${call.timestamp.split('T')[0]}`);
      });
    }
    
    return uniqueCalls;
    
  } catch (error) {
    console.error('❌ Extraction failed:', error);
    throw error;
  }
}

// Run extraction if this script is executed directly
if (require.main === module) {
  extractLsyCalls()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Extraction failed:', error);
      process.exit(1);
    });
}

module.exports = { extractLsyCalls };
