const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

// Import CA drops from extracted JSON
async function importCADrops() {
  try {
    // Read the extracted CA drops
    const caDropsData = JSON.parse(fs.readFileSync('./extracted_ca_drops.json', 'utf-8'));
    
    console.log(`📊 Found ${caDropsData.length} CA drops to import`);
    
    // Filter for @memeworldorder drops only
    const memeworldorderDrops = caDropsData.filter(drop => 
      drop.username.includes('meme world order') || drop.username.includes('memeworldorder')
    );
    
    console.log(`🎯 Found ${memeworldorderDrops.length} drops from @memeworldorder`);
    
    // Display sample drops
    console.log('\n📋 Sample @memeworldorder CA drops:');
    memeworldorderDrops.slice(0, 5).forEach((drop, index) => {
      console.log(`${index + 1}. ${drop.address} (${drop.chain}) - ${drop.timestamp}`);
      if (drop.metadata) {
        console.log(`   Token: ${drop.metadata.name} (${drop.metadata.symbol})`);
        console.log(`   Price: $${drop.metadata.price?.toFixed(8) || 'N/A'}`);
        console.log(`   Market Cap: $${(drop.metadata.marketCap / 1000000)?.toFixed(2) || 'N/A'}M`);
      }
      console.log('');
    });
    
    // For now, just display the data - in a real implementation, you'd save to database
    console.log('✅ CA drops analysis complete!');
    console.log('\n📈 Summary:');
    console.log(`• Total CA drops found: ${caDropsData.length}`);
    console.log(`• @memeworldorder drops: ${memeworldorderDrops.length}`);
    
    // Chain distribution
    const chainStats = {};
    memeworldorderDrops.forEach(drop => {
      chainStats[drop.chain] = (chainStats[drop.chain] || 0) + 1;
    });
    
    console.log('\n🔗 Chain distribution for @memeworldorder:');
    Object.entries(chainStats).forEach(([chain, count]) => {
      console.log(`  ${chain}: ${count} tokens`);
    });
    
  } catch (error) {
    console.error('❌ Error importing CA drops:', error.message);
  }
}

// Run the import
if (require.main === module) {
  importCADrops().catch(console.error);
}

module.exports = { importCADrops };
