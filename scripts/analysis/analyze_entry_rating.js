const fs = require('fs');
const path = require('path');

/**
 * Analyze entry rating - how much tokens went down after alert.
 * Scans simulation CSV output and corresponding OHLCV data to evaluate
 * the potential entry quality and hypothetical trade outcomes.
 */
async function analyzeEntryRating() {
  console.log('🔍 Analyzing Entry Rating for Brook CA Drops...\n');
  
  const resultsFile = './brook_simulations/brook_simulation_results_2025-10-25.csv'; // File with simulation output
  const ohlcvDir = './brook_ohlcv'; // Directory with OHLCV data per token
  
  // Read the results CSV into memory as a string
  const csvContent = fs.readFileSync(resultsFile, 'utf8');
  const lines = csvContent.split('\n'); // Split by line
  const headers = lines[0].split(','); // Extract CSV headers
  
  const results = []; // Holds successful simulation results
  
  // Parse CSV data into objects
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) { // Skip empty lines
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim(); // Attach value to corresponding header
      });
      
      // Only push rows without errors and valid 'Simulation PNL'
      if (row['Error'] === '' && row['Simulation PNL'] !== 'N/A') {
        results.push(row);
      }
    }
  }
  
  console.log(`📊 Found ${results.length} successful entries to analyze\n`);
  
  const entryRatings = []; // Holds metrics for each analyzed entry
  
  // Analyze each result (one per "call"/token)
  for (const result of results) {
    const tokenSymbol = result['Token Symbol']; // e.g. "BTC"
    const callPrice = parseFloat(result['Updated Call Price']); // called entry USD price
    const ohlcvFile = result['OHLCV File']; // filename for OHLCV of this token
    
    if (!ohlcvFile || ohlcvFile === 'N/A') continue; // Skip if no OHLCV file
    
    try {
      // Build path to the OHLCV file and read it
      const ohlcvPath = path.join(ohlcvDir, ohlcvFile);
      const ohlcvContent = fs.readFileSync(ohlcvPath, 'utf8');
      const ohlcvLines = ohlcvContent.split('\n'); // OHLCV lines by candle
      const ohlcvHeaders = ohlcvLines[0].split(','); // Unused: OHLCV header
      
      let minPrice = callPrice; // Start from call price (minimum seen post-call)
      let maxPrice = callPrice; // Start from call price (maximum seen post-call)
      let candlesAfterCall = 0; // Counter: number of candles after signal
      
      // Get milliseconds timestamp of when the alert ("call") was made
      const callTimestamp = new Date(result['Timestamp']).getTime();
      
      // Scan all OHLCV candles after the call for min/max price movement
      for (let i = 1; i < ohlcvLines.length; i++) {
        if (ohlcvLines[i].trim()) {
          const values = ohlcvLines[i].split(',');
          const candleTimestamp = parseInt(values[0]); // Candle timestamp (milliseconds)
          
          // Only process candles after the alert
          if (candleTimestamp > callTimestamp) {
            candlesAfterCall++; // Count how many after the call
            const low = parseFloat(values[3]); // Low price of this candle
            const high = parseFloat(values[2]); // High price of this candle
            
            if (low < minPrice) minPrice = low; // Track lowest
            if (high > maxPrice) maxPrice = high; // Track highest
          }
        }
      }
      
      // Calculate the percentage drop post-call (entry rating)
      const entryRating = ((minPrice - callPrice) / callPrice) * 100; // Percent down
      const maxGain = ((maxPrice - callPrice) / callPrice) * 100; // Percent up
      
      // Hypothetical entry: enter at -50% dip from call
      const entryPrice = callPrice * 0.5; // Enter if price halves
      const stopLossPrice = entryPrice * 0.7; // -30% stop loss from entry price
      
      // If price ever dips to/below stop loss, simulate stopping out
      const stopLossHit = minPrice <= stopLossPrice;
      // Theoretical exit price: stop loss if hit, else at max price achieved post-entry
      const finalPrice = stopLossHit ? stopLossPrice : maxPrice;
      // Hypothetical profit/loss from entry to exit
      const profitLoss = ((finalPrice - entryPrice) / entryPrice) * 100;
      
      // Aggregate all results for this token/call
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
      
      // Console summary for each token checked
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
      // Typically file/parse errors: skip this token
      console.log(`❌ Error analyzing ${tokenSymbol}: ${error.message}`);
    }
  }
  
  // Calculate and report summary statistics from all entries
  if (entryRatings.length > 0) {
    // Average percent drawdown (entry rating)
    const avgEntryRating = entryRatings.reduce((sum, r) => sum + r.entryRating, 0) / entryRatings.length;
    // Average max possible percent gain
    const avgMaxGain = entryRatings.reduce((sum, r) => sum + r.maxGain, 0) / entryRatings.length;
    // Average number of post-call candles checked
    const avgCandlesAfterCall = entryRatings.reduce((sum, r) => sum + r.candlesAfterCall, 0) / entryRatings.length;
    // Average profit or loss across all entries (based on model strategy)
    const avgProfitLoss = entryRatings.reduce((sum, r) => sum + r.profitLoss, 0) / entryRatings.length;

    // Count how many would have hit stop loss
    const stopLossesHit = entryRatings.filter(r => r.stopLossHit).length;
    const stopLossRate = (stopLossesHit / entryRatings.length) * 100;

    // Total profit/loss for all simulated entries (hypothetical batch result)
    const totalProfitLoss = entryRatings.reduce((sum, r) => sum + r.profitLoss, 0);

    // Print formatted summary to console
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

    // Find trade with lowest and highest profit for display
    const worstProfit = entryRatings.reduce((worst, current) => 
      current.profitLoss < worst.profitLoss ? current : worst
    );
    const bestProfit = entryRatings.reduce((best, current) => 
      current.profitLoss > best.profitLoss ? current : best
    );

    console.log(`\n🎯 WORST Profit: ${worstProfit.token} (${worstProfit.profitLoss.toFixed(1)}%)`);
    console.log(`🎯 BEST Profit: ${bestProfit.token} (${bestProfit.profitLoss.toFixed(1)}%)`);

    // Count profitable and losing trades for the strategy
    const profitableTrades = entryRatings.filter(r => r.profitLoss > 0);
    const losingTrades = entryRatings.filter(r => r.profitLoss <= 0);

    console.log(`\n📈 Profitable Trades: ${profitableTrades.length} (${(profitableTrades.length/entryRatings.length*100).toFixed(1)}%)`);
    console.log(`📉 Losing Trades: ${losingTrades.length} (${(losingTrades.length/entryRatings.length*100).toFixed(1)}%)`);

    // Generate CSV for the analysis results for later review
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

    // Save analysis as CSV with today's date
    const csvFilename = `entry_rating_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(csvFilename, csvContent);
    console.log(`\n💾 Results exported to: ${csvFilename}`);
  }
}

// Run the analysis and catch any unexpected outer errors
analyzeEntryRating().catch(console.error);
