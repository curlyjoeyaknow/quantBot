const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- Configuration ---
const MESSAGES_DIR = './messages'; // Directory containing telegram chat HTMLs
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || ''; // Optional API key
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb']; // Users to skip CA drops from

// Extract CA drops from HTML files, collecting token addresses and associated messages
function extractCADrops() {
  const caDrops = []; // Output array for detected CA drops

  // Read, filter, and sort message files by descending number (most recent first)
  const files = fs.readdirSync(MESSAGES_DIR)
    .filter(file => file.startsWith('messages') && file.endsWith('.html'))
    .sort((a, b) => {
      // Extract numeric part of filename to sort
      const numA = parseInt(a.match(/messages(\d+)\.html/)?.[1] || '0');
      const numB = parseInt(b.match(/messages(\d+)\.html/)?.[1] || '0');
      return numB - numA;
    });

  console.log(`Found ${files.length} message files`);

  // Process each HTML file
  for (const file of files) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(MESSAGES_DIR, file);

    // Load file content as UTF-8 text
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Regex: match each message div, capturing message ID and HTML inner content
    const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let match;
    
    // Iterate through each message found in file
    while ((match = messageRegex.exec(content)) !== null) {
      const messageId = match[1];          // Extracted message ID
      const messageContent = match[2];     // Inner HTML of message
      
      // Extract timestamp from title attribute (format may vary)
      const timestampMatch = messageContent.match(/title="([^"]+)"/);
      if (!timestampMatch) continue;       // Skip if timestamp is not present
      
      const timestamp = timestampMatch[1];
      
      // Extract the username (sender) from <div class="from_name">
      const usernameMatch = messageContent.match(/<div class="from_name">\s*([^<]+)\s*<\/div>/);
      if (!usernameMatch) continue;        // Skip messages with no username
      
      const username = usernameMatch[1].toLowerCase().trim();
      
      // Filter out excluded/banned usernames
      if (EXCLUDED_USERS.some(excluded => username.includes(excluded))) {
        continue;
      }
      
      // Extract actual message text (not all messages have this)
      const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (!textMatch) continue;            // Only interested in standard messages
      
      const messageText = textMatch[1];    // Raw HTML: may contain links, tags, etc.
      
      // --- Token address extraction ---
      // Solana address: 32-44 base58 chars, no 0,O,I,l or ambiguous base58
      const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
      // EVM address: 0x followed by 40 hex chars (case insensitive)
      const evmAddressRegex = /0x[a-fA-F0-9]{40}/g;
      
      // Grab all token address matches, both types
      const solanaMatches = messageText.match(solanaAddressRegex) || [];
      const evmMatches = messageText.match(evmAddressRegex) || [];
      
      // Check for CA-related "alpha drop"/shill keywords (not required for inclusion)
      const caKeywords = ['ca:', 'contract', 'address', 'buy', 'pump', 'gem', 'moonshot', 'call', 'alpha'];
      const hasCAKeywords = caKeywords.some(keyword => 
        messageText.toLowerCase().includes(keyword.toLowerCase())
      );
      
      // If we found at least one candidate address, treat this as a CA drop
      if (solanaMatches.length > 0 || evmMatches.length > 0) {
        // Combine all found addresses: deduplication per-message not performed here
        const addresses = [...solanaMatches, ...evmMatches];
        
        for (const address of addresses) {
          // Determine chain: Solana pattern or EVM pattern flag
          let chain = 'solana';
          if (address.startsWith('0x')) {
            chain = 'unknown_evm'; // Actual EVM chain will be determined after using Birdeye
          }
          
          // Save drop info; strip any HTML from text to get readable message
          caDrops.push({
            messageId,
            username,
            timestamp,
            address,
            chain,
            messageText: messageText.replace(/<[^>]*>/g, ''), // Remove HTML tags
            file,
            hasCAKeywords
          });
        }
      }
    }
  }
  
  return caDrops;
}

// Fetches token metadata from Birdeye API for one address+chain combo
async function fetchTokenMetadata(address, chain) {
  try {
    // Make GET request to Birdeye
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
    
    // If token found, gather a little metadata (adapt fields if needed)
    if (response.data.success && response.data.data) {
      return {
        name: response.data.data.name,
        symbol: response.data.data.symbol,
        price: response.data.data.price,
        marketCap: response.data.data.mc
      };
    }
  } catch (error) {
    // Print error info; fallback to null for not found/errors/rate limit
    console.log(`Failed to fetch metadata for ${address} on ${chain}: ${error.response?.data?.message || error.message}`);
  }
  
  return null;
}

// --- Orchestrates extraction process: scan files, deduplicate, enrich with API & save summary
async function main() {
  console.log('🔍 Extracting CA drops from chat history...');
  
  const caDrops = extractCADrops();
  console.log(`Found ${caDrops.length} potential CA drops`);
  
  // --- Deduplicate by address+username --- (prefer most recent if multiple from user)
  const uniqueDrops = new Map();
  caDrops.forEach(drop => {
    const key = `${drop.address}_${drop.username}`; // Address+user as composite key
    // If multiple, retain only latest/most recent timestamp
    if (!uniqueDrops.has(key) || new Date(drop.timestamp) > new Date(uniqueDrops.get(key).timestamp)) {
      uniqueDrops.set(key, drop);
    }
  });
  
  const uniqueCAArray = Array.from(uniqueDrops.values());
  console.log(`Unique CA drops: ${uniqueCAArray.length}`);
  
  // --- Look up metadata for each distinct CA token address ---
  const results = [];
  for (const drop of uniqueCAArray) {
    console.log(`\n📊 Processing: ${drop.address} by ${drop.username}`);
    
    let metadata = null;
    let finalChain = drop.chain;
    
    // For generic EVM addresses, try them one after the other (BSC => ETH => Base)
    if (drop.chain === 'unknown_evm') {
      const evmChains = ['bsc', 'ethereum', 'base'];
      for (const chain of evmChains) {
        metadata = await fetchTokenMetadata(drop.address, chain);
        if (metadata) {   // Stop at first chain that gets a match
          finalChain = chain;
          break;
        }
      }
    } else {
      // For Solana formatted addresses, check only Solana
      metadata = await fetchTokenMetadata(drop.address, 'solana');
    }
    
    // Compose successful result with full info and normalized ISO timestamp
    if (metadata) {
      results.push({
        ...drop,
        chain: finalChain,
        metadata,
        timestamp: new Date(drop.timestamp).toISOString()
      });
      console.log(`✅ Found: ${metadata.name} (${metadata.symbol}) on ${finalChain}`);
    } else {
      // Did not find metadata for this address/chain combination
      console.log(`❌ No metadata found for ${drop.address}`);
    }
    
    // Slight pause between requests to limit rate (100ms)
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // --- Write results to disk as formatted JSON file ---
  const outputFile = './extracted_ca_drops.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n🎉 Extraction complete! Found ${results.length} CA drops with metadata`);
  console.log(`📁 Results saved to: ${outputFile}`);
  
  // --- Print summary statistics per chain ---
  const chainStats = {};
  results.forEach(drop => {
    chainStats[drop.chain] = (chainStats[drop.chain] || 0) + 1;
  });
  
  console.log('\n📊 Chain distribution:');
  Object.entries(chainStats).forEach(([chain, count]) => {
    console.log(`  ${chain}: ${count} tokens`);
  });
}

// Only run if this script is the entrypoint directly (not imported)
if (require.main === module) {
  main().catch(console.error);
}

// Export for unit testing or for use from other files
module.exports = { extractCADrops, fetchTokenMetadata };
