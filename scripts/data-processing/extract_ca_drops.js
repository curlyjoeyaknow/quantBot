const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const MESSAGES_DIR = './messages';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const EXCLUDED_USERS = ['rick', 'phanes', 'pirb'];

// Extract CA drops from HTML files
function extractCADrops() {
  const caDrops = [];
  const files = fs.readdirSync(MESSAGES_DIR)
    .filter(file => file.startsWith('messages') && file.endsWith('.html'))
    .sort((a, b) => {
      // Sort by number (messages17.html > messages16.html > ...)
      const numA = parseInt(a.match(/messages(\d+)\.html/)?.[1] || '0');
      const numB = parseInt(b.match(/messages(\d+)\.html/)?.[1] || '0');
      return numB - numA; // Most recent first
    });

  console.log(`Found ${files.length} message files`);

  for (const file of files) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(MESSAGES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Extract messages using regex - improved pattern
    const messageRegex = /<div class="message default clearfix[^"]*" id="message(\d+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let match;
    
    while ((match = messageRegex.exec(content)) !== null) {
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
      
      // Extract message text - handle both regular and joined messages
      const textMatch = messageContent.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (!textMatch) continue;
      
      const messageText = textMatch[1];
      
      // Look for token addresses (Solana and EVM)
      const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
      const evmAddressRegex = /0x[a-fA-F0-9]{40}/g;
      
      const solanaMatches = messageText.match(solanaAddressRegex) || [];
      const evmMatches = messageText.match(evmAddressRegex) || [];
      
      // Look for CA-related keywords or just addresses (some CA drops might not have keywords)
      const caKeywords = ['ca:', 'contract', 'address', 'buy', 'pump', 'gem', 'moonshot', 'call', 'alpha'];
      const hasCAKeywords = caKeywords.some(keyword => 
        messageText.toLowerCase().includes(keyword.toLowerCase())
      );
      
      // If we found addresses, it could be a CA drop (even without keywords)
      if (solanaMatches.length > 0 || evmMatches.length > 0) {
        const addresses = [...solanaMatches, ...evmMatches];
        
        for (const address of addresses) {
          // Determine chain based on address format
          let chain = 'solana';
          if (address.startsWith('0x')) {
            chain = 'unknown_evm'; // Will be determined later
          }
          
          caDrops.push({
            messageId,
            username,
            timestamp,
            address,
            chain,
            messageText: messageText.replace(/<[^>]*>/g, ''), // Strip HTML tags
            file,
            hasCAKeywords
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
        price: response.data.data.price,
        marketCap: response.data.data.mc
      };
    }
  } catch (error) {
    console.log(`Failed to fetch metadata for ${address} on ${chain}: ${error.response?.data?.message || error.message}`);
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
      results.push({
        ...drop,
        chain: finalChain,
        metadata,
        timestamp: new Date(drop.timestamp).toISOString()
      });
      console.log(`✅ Found: ${metadata.name} (${metadata.symbol}) on ${finalChain}`);
    } else {
      console.log(`❌ No metadata found for ${drop.address}`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Save results to JSON file
  const outputFile = './extracted_ca_drops.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n🎉 Extraction complete! Found ${results.length} CA drops with metadata`);
  console.log(`📁 Results saved to: ${outputFile}`);
  
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
