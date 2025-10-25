const fs = require('fs');
const path = require('path');

/**
 * Analyze entry rating - how much tokens went down after alert
 */
async function analyzeEntryRating() {
  console.log('🔍 Analyzing Entry Rating for Brook CA Drops...\n');
  
  const resultsFile = './brook_simulations/brook_simulation_results_2025-10-25.csv';
  const ohlcvDir = './brook_ohlcv';
  
  // Read the results CSV
  const csvContent = fs.readFileSync(resultsFile, 'utf8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');
  
  const results = [];
  
  // Parse CSV data
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim();
      });
      
      // Only process successful entries
      if (row['Error'] === '' && row['Simulation PNL'] !== 'N/A') {
        results.push(row);
      }
    }
  }
  
  console.log(`📊 Found ${results.length} successful entries to analyze\n`);
  
  const entryRatings = [];
  
  for (const result of results) {
    const tokenSymbol = result['Token Symbol'];
    const callPrice = parseFloat(result['Updated Call Price']);
    const ohlcvFile = result['OHLCV File'];
    
    if (!ohlcvFile || ohlcvFile === 'N/A') continue;
    
    try {
      // Read OHLCV data
      const ohlcvPath = path.join(ohlcvDir, ohlcvFile);
      const ohlcvContent = fs.readFileSync(ohlcvPath, 'utf8');
      const ohlcvLines = ohlcvContent.split('\n');
      const ohlcvHeaders = ohlcvLines[0].split(',');
      
      let minPrice = callPrice;
      let maxPrice = callPrice;
      let candlesAfterCall = 0;
      
      // Find the call timestamp and analyze prices after it
      const callTimestamp = new Date(result['Timestamp']).getTime();
      
      for (let i = 1; i < ohlcvLines.length; i++) {
        if (ohlcvLines[i].trim()) {
          const values = ohlcvLines[i].split(',');
          const candleTimestamp = parseInt(values[0]);
          
          // Only analyze candles after the call
          if (candleTimestamp > callTimestamp) {
            candlesAfterCall++;
            const low = parseFloat(values[3]); // Low price
            const high = parseFloat(values[2]); // High price
            
            if (low < minPrice) minPrice = low;
            if (high > maxPrice) maxPrice = high;
          }
        }
      }
      
      // Calculate entry rating (how much it went down)
      const entryRating = ((minPrice - callPrice) / callPrice) * 100;
      const maxGain = ((maxPrice - callPrice) / callPrice) * 100;
      
      // Calculate profits with -50% entry and -30% stop loss
      const entryPrice = callPrice * 0.5; // Enter at -50% from call price
      const stopLossPrice = entryPrice * 0.7; // Stop loss at -30% from entry price
      
      // Check if stop loss would have been hit
      const stopLossHit = minPrice <= stopLossPrice;
      const finalPrice = stopLossHit ? stopLossPrice : maxPrice;
      const profitLoss = ((finalPrice - entryPrice) / entryPrice) * 100;
      
      entryRatings.push({
        token: tokenSymbol,
        callPrice: callPrice,
        minPrice: minPrice,
        maxPrice: maxPrice,
        entryPrice: entryPrice,
        stopLossPrice: stopLossPrice,
        entryRating: entryRating,
        maxGain: maxGain,
        stopLossHit: stopLossHit,
        profitLoss: profitLoss,
        finalPrice: finalPrice,
        candlesAfterCall: candlesAfterCall
      });
      
      console.log(`📈 ${tokenSymbol}:`);
      console.log(`   Call Price: $${callPrice.toFixed(8)}`);
      console.log(`   Entry Price: $${entryPrice.toFixed(8)} (-50% from call)`);
      console.log(`   Stop Loss: $${stopLossPrice.toFixed(8)} (-30% from entry)`);
      console.log(`   Min Price: $${minPrice.toFixed(8)} (${entryRating.toFixed(1)}% down from call)`);
      console.log(`   Max Price: $${maxPrice.toFixed(8)} (${maxGain.toFixed(1)}% up from call)`);
      console.log(`   Stop Loss Hit: ${stopLossHit ? 'YES' : 'NO'}`);
      console.log(`   Final Price: $${finalPrice.toFixed(8)}`);
      console.log(`   Profit/Loss: ${profitLoss.toFixed(1)}%`);
      console.log(`   Candles After Call: ${candlesAfterCall}`);
      console.log('');
      
    } catch (error) {
      console.log(`❌ Error analyzing ${tokenSymbol}: ${error.message}`);
    }
  }
  
  // Calculate averages
  if (entryRatings.length > 0) {
    const avgEntryRating = entryRatings.reduce((sum, r) => sum + r.entryRating, 0) / entryRatings.length;
    const avgMaxGain = entryRatings.reduce((sum, r) => sum + r.maxGain, 0) / entryRatings.length;
    const avgCandlesAfterCall = entryRatings.reduce((sum, r) => sum + r.candlesAfterCall, 0) / entryRatings.length;
    const avgProfitLoss = entryRatings.reduce((sum, r) => sum + r.profitLoss, 0) / entryRatings.length;
    
    // Count stop losses hit
    const stopLossesHit = entryRatings.filter(r => r.stopLossHit).length;
    const stopLossRate = (stopLossesHit / entryRatings.length) * 100;
    
    // Calculate total profit/loss
    const totalProfitLoss = entryRatings.reduce((sum, r) => sum + r.profitLoss, 0);
    
    console.log('📊 SUMMARY:');
    console.log(`   Average Entry Rating: ${avgEntryRating.toFixed(1)}% down`);
    console.log(`   Average Max Gain: ${avgMaxGain.toFixed(1)}% up`);
    console.log(`   Average Candles After Call: ${avgCandlesAfterCall.toFixed(0)}`);
    console.log(`   Total Tokens Analyzed: ${entryRatings.length}`);
    console.log('');
    console.log('💰 PROFIT/LOSS ANALYSIS (Entry at -50%, Stop Loss at -30%):');
    console.log(`   Average Profit/Loss: ${avgProfitLoss.toFixed(1)}%`);
    console.log(`   Total Profit/Loss: ${totalProfitLoss.toFixed(1)}%`);
    console.log(`   Stop Losses Hit: ${stopLossesHit}/${entryRatings.length} (${stopLossRate.toFixed(1)}%)`);
    console.log(`   Success Rate: ${(100 - stopLossRate).toFixed(1)}%`);
    
    // Show worst and best profits
    const worstProfit = entryRatings.reduce((worst, current) => 
      current.profitLoss < worst.profitLoss ? current : worst
    );
    const bestProfit = entryRatings.reduce((best, current) => 
      current.profitLoss > best.profitLoss ? current : best
    );
    
    console.log(`\n🎯 WORST Profit: ${worstProfit.token} (${worstProfit.profitLoss.toFixed(1)}%)`);
    console.log(`🎯 BEST Profit: ${bestProfit.token} (${bestProfit.profitLoss.toFixed(1)}%)`);
    
    // Show profitable vs losing trades
    const profitableTrades = entryRatings.filter(r => r.profitLoss > 0);
    const losingTrades = entryRatings.filter(r => r.profitLoss <= 0);
    
    console.log(`\n📈 Profitable Trades: ${profitableTrades.length} (${(profitableTrades.length/entryRatings.length*100).toFixed(1)}%)`);
    console.log(`📉 Losing Trades: ${losingTrades.length} (${(losingTrades.length/entryRatings.length*100).toFixed(1)}%)`);
    
    // Export results to CSV
    const csvContent = [
      'Token,Call Price,Entry Price,Stop Loss Price,Min Price,Max Price,Entry Rating %,Max Gain %,Stop Loss Hit,Final Price,Profit Loss %,Candles After Call',
      ...entryRatings.map(r => [
        r.token,
        r.callPrice.toFixed(8),
        r.entryPrice.toFixed(8),
        r.stopLossPrice.toFixed(8),
        r.minPrice.toFixed(8),
        r.maxPrice.toFixed(8),
        r.entryRating.toFixed(1),
        r.maxGain.toFixed(1),
        r.stopLossHit ? 'YES' : 'NO',
        r.finalPrice.toFixed(8),
        r.profitLoss.toFixed(1),
        r.candlesAfterCall
      ].join(','))
    ].join('\n');
    
    const csvFilename = `entry_rating_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(csvFilename, csvContent);
    console.log(`\n💾 Results exported to: ${csvFilename}`);
  }
}

// Run the analysis
analyzeEntryRating().catch(console.error);
