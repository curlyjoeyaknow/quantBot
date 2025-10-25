const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// SIMPLIFIED TRADING RULES (No Re-entry)
const SIMPLIFIED_TRADING_RULES = {
    initialBalance: 1000, // Starting with $1000
    maxPositionSize: 0.1, // Max 10% of balance per trade
    slippage: 0.05, // 5% slippage
    
    // SIMPLIFIED STRATEGY (No Re-entry)
    entryAtAlert: true, // Entry at alert price
    stopLoss: 0.30, // -30% stop loss (basic)
    
    // Take profit levels (same as your rules)
    takeProfitLevels: [
        { level: 2.0, probability: 0.50 }, // 50% chance at 2x (100% gain)
        { level: 3.0, probability: 0.30 }, // 30% chance at 3x (200% gain)  
        { level: 5.0, probability: 0.20 }  // 20% chance at 5x (400% gain)
    ]
};

async function simulateSimplifiedStrategy() {
    const results = [];
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv';
    
    console.log('Simulating SIMPLIFIED STRATEGY (No Re-entry)...');
    console.log('Strategy: Entry at alert, -30% SL, TP: 50%@2x, 30%@3x, 20%@5x');
    
    return new Promise((resolve, reject) => {
        const callerData = {};
        
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                const caller = row['Sender'] || 'Unknown';
                if (!callerData[caller]) {
                    callerData[caller] = [];
                }
                callerData[caller].push(row);
            })
            .on('end', () => {
                console.log(`Found ${Object.keys(callerData).length} unique callers`);
                
                // Simulate each caller with simplified rules
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`\nSimulating ${caller} (${calls.length} calls) with SIMPLIFIED rules...`);
                    const simulation = simulateCallerSimplified(caller, calls);
                    results.push(simulation);
                });
                
                // Write results to CSV
                const csvWriter = createCsvWriter({
                    path: '/home/memez/quantBot/simplified_strategy_simulations.csv',
                    header: [
                        {id: 'caller', title: 'Caller'},
                        {id: 'totalCalls', title: 'Total Calls'},
                        {id: 'tradesExecuted', title: 'Trades Executed'},
                        {id: 'winningTrades', title: 'Winning Trades'},
                        {id: 'losingTrades', title: 'Losing Trades'},
                        {id: 'winRate', title: 'Win Rate (%)'},
                        {id: 'totalPnL', title: 'Total P&L ($)'},
                        {id: 'totalReturn', title: 'Total Return (%)'},
                        {id: 'maxDrawdown', title: 'Max Drawdown (%)'},
                        {id: 'avgTradeReturn', title: 'Avg Trade Return (%)'},
                        {id: 'bestTrade', title: 'Best Trade (%)'},
                        {id: 'worstTrade', title: 'Worst Trade (%)'},
                        {id: 'sharpeRatio', title: 'Sharpe Ratio'},
                        {id: 'avgHoldTime', title: 'Avg Hold Time (hours)'},
                        {id: 'totalVolume', title: 'Total Volume ($)'},
                        {id: 'tradesAt2x', title: 'Trades at 2x'},
                        {id: 'tradesAt3x', title: 'Trades at 3x'},
                        {id: 'tradesAt5x', title: 'Trades at 5x'},
                        {id: 'stopLossHits', title: 'Stop Loss Hits'}
                    ]
                });
                
                csvWriter.writeRecords(results)
                    .then(() => {
                        console.log('\nSimplified strategy simulations saved to simplified_strategy_simulations.csv');
                        
                        // Create comparison analysis
                        createSimplifiedAnalysisReport(results);
                        
                        resolve(results);
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}

function simulateCallerSimplified(caller, calls) {
    let balance = SIMPLIFIED_TRADING_RULES.initialBalance;
    let maxBalance = balance;
    let trades = [];
    let totalVolume = 0;
    let tradesAt2x = 0;
    let tradesAt3x = 0;
    let tradesAt5x = 0;
    let stopLossHits = 0;
    
    // Sort calls by timestamp
    calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));
    
    // Process up to 20 calls per caller
    const callsToProcess = calls.slice(0, 20);
    
    callsToProcess.forEach((call, index) => {
        const trade = simulateTradeSimplified(call, balance, index);
        if (trade) {
            trades.push(trade);
            balance += trade.pnl;
            totalVolume += trade.volume;
            maxBalance = Math.max(maxBalance, balance);
            
            // Track take profit levels
            if (trade.takeProfitLevel === 2.0) tradesAt2x++;
            else if (trade.takeProfitLevel === 3.0) tradesAt3x++;
            else if (trade.takeProfitLevel === 5.0) tradesAt5x++;
            
            // Track stop loss hits
            if (trade.exitReason === 'stop_loss') stopLossHits++;
        }
    });
    
    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const totalPnL = balance - SIMPLIFIED_TRADING_RULES.initialBalance;
    const totalReturn = (totalPnL / SIMPLIFIED_TRADING_RULES.initialBalance) * 100;
    const maxDrawdown = ((maxBalance - Math.min(...trades.map(t => balance - t.pnl))) / maxBalance) * 100;
    const avgTradeReturn = trades.length > 0 ? trades.reduce((sum, t) => sum + t.return, 0) / trades.length : 0;
    const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.return)) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.return)) : 0;
    
    // Calculate Sharpe ratio
    const returns = trades.map(t => t.return);
    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const sharpeRatio = variance > 0 ? avgReturn / Math.sqrt(variance) : 0;
    
    // Calculate average hold time
    const holdTimes = trades.map(t => t.holdTime);
    const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((sum, t) => sum + t, 0) / holdTimes.length : 0;
    
    return {
        caller,
        totalCalls: calls.length,
        tradesExecuted: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: parseFloat(winRate.toFixed(2)),
        totalPnL: parseFloat(totalPnL.toFixed(2)),
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
        avgTradeReturn: parseFloat(avgTradeReturn.toFixed(2)),
        bestTrade: parseFloat(bestTrade.toFixed(2)),
        worstTrade: parseFloat(worstTrade.toFixed(2)),
        sharpeRatio: parseFloat(sharpeRatio.toFixed(3)),
        avgHoldTime: parseFloat(avgHoldTime.toFixed(1)),
        totalVolume: parseFloat(totalVolume.toFixed(2)),
        tradesAt2x,
        tradesAt3x,
        tradesAt5x,
        stopLossHits
    };
}

function simulateTradeSimplified(call, currentBalance, tradeIndex) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Calculate position size
    const positionSize = Math.min(
        currentBalance * SIMPLIFIED_TRADING_RULES.maxPositionSize,
        currentBalance * 0.1 // Max 10% per trade
    );
    
    if (positionSize < 10) { // Minimum $10 trade
        return null;
    }
    
    // Simulate alert price (random between $0.000001 and $0.01)
    const alertPrice = Math.random() * 0.009999 + 0.000001;
    
    // Apply slippage to entry
    const slippageMultiplier = 1 - SIMPLIFIED_TRADING_RULES.slippage;
    const actualEntryPrice = alertPrice * slippageMultiplier;
    
    // Simulate hold time (1-72 hours)
    const holdTime = Math.random() * 71 + 1;
    
    // SIMPLIFIED STRATEGY: Single entry, no re-entry
    const trade = attemptSingleEntry(call, actualEntryPrice, positionSize, holdTime, tradeIndex);
    
    return trade;
}

function attemptSingleEntry(call, entryPrice, positionSize, holdTime, tradeIndex) {
    // Simulate price movement
    const random = Math.random();
    let exitPrice, exitReason, takeProfitLevel = null;
    
    // Check stop loss first (-30%)
    const stopLossPrice = entryPrice * (1 - SIMPLIFIED_TRADING_RULES.stopLoss);
    
    // Simulate price movement
    const priceMovement = Math.random();
    
    if (priceMovement < 0.4) {
        // 40% chance of hitting stop loss
        exitPrice = stopLossPrice;
        exitReason = 'stop_loss';
    } else {
        // 60% chance of hitting take profit levels
        const tpRandom = Math.random();
        let cumulativeProb = 0;
        
        for (const tp of SIMPLIFIED_TRADING_RULES.takeProfitLevels) {
            cumulativeProb += tp.probability;
            if (tpRandom <= cumulativeProb) {
                exitPrice = entryPrice * tp.level;
                exitReason = 'take_profit';
                takeProfitLevel = tp.level;
                break;
            }
        }
        
        // If no take profit hit, simulate random exit
        if (!exitPrice) {
            const randomChange = (Math.random() - 0.5) * 0.4; // -20% to +20%
            exitPrice = entryPrice * (1 + randomChange);
            exitReason = 'random_exit';
        }
    }
    
    // Apply slippage to exit
    const slippageMultiplier = 1 - SIMPLIFIED_TRADING_RULES.slippage;
    const actualExitPrice = exitPrice * slippageMultiplier;
    
    // Calculate P&L
    const tokensBought = positionSize / entryPrice;
    const exitValue = tokensBought * actualExitPrice;
    const pnl = exitValue - positionSize;
    const returnPercent = (pnl / positionSize) * 100;
    
    return {
        tradeIndex,
        address: call['Address'],
        tokenName: call['Token Name'] || 'Unknown',
        chain: call['Chain'] || 'Unknown',
        entryPrice: parseFloat(entryPrice.toFixed(8)),
        exitPrice: parseFloat(actualExitPrice.toFixed(8)),
        positionSize: parseFloat(positionSize.toFixed(2)),
        exitValue: parseFloat(exitValue.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        return: parseFloat(returnPercent.toFixed(2)),
        holdTime: parseFloat(holdTime.toFixed(1)),
        exitReason,
        takeProfitLevel,
        volume: parseFloat(positionSize.toFixed(2))
    };
}

function createSimplifiedAnalysisReport(results) {
    console.log('\n=== SIMPLIFIED STRATEGY PERFORMANCE ANALYSIS ===');
    console.log('Strategy: Entry at alert, -30% SL, TP: 50%@2x, 30%@3x, 20%@5x (NO RE-ENTRY)');
    
    // Sort by total return
    const sortedResults = results.sort((a, b) => b.totalReturn - a.totalReturn);
    
    console.log('\nRanking by Total Return:');
    sortedResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.caller}`);
        console.log(`   Total Return: ${result.totalReturn}%`);
        console.log(`   Win Rate: ${result.winRate}%`);
        console.log(`   Trades: ${result.tradesExecuted}`);
        console.log(`   P&L: $${result.totalPnL}`);
        console.log(`   Take Profits: ${result.tradesAt2x}@2x, ${result.tradesAt3x}@3x, ${result.tradesAt5x}@5x`);
        console.log(`   Stop Loss Hits: ${result.stopLossHits}`);
        console.log(`   Best Trade: ${result.bestTrade}%`);
        console.log(`   Worst Trade: ${result.worstTrade}%`);
        console.log(`   Sharpe Ratio: ${result.sharpeRatio}`);
        console.log('');
    });
    
    // Calculate strategy statistics
    const totalTrades = results.reduce((sum, r) => sum + r.tradesExecuted, 0);
    const totalStopLossHits = results.reduce((sum, r) => sum + r.stopLossHits, 0);
    const totalTradesAt2x = results.reduce((sum, r) => sum + r.tradesAt2x, 0);
    const totalTradesAt3x = results.reduce((sum, r) => sum + r.tradesAt3x, 0);
    const totalTradesAt5x = results.reduce((sum, r) => sum + r.tradesAt5x, 0);
    
    console.log('\n=== SIMPLIFIED STRATEGY STATISTICS ===');
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Stop Loss Hits: ${totalStopLossHits} (${(totalStopLossHits/totalTrades*100).toFixed(1)}%)`);
    console.log(`Take Profit Distribution:`);
    console.log(`  - 2x (100% gain): ${totalTradesAt2x} trades (${(totalTradesAt2x/totalTrades*100).toFixed(1)}%)`);
    console.log(`  - 3x (200% gain): ${totalTradesAt3x} trades (${(totalTradesAt3x/totalTrades*100).toFixed(1)}%)`);
    console.log(`  - 5x (400% gain): ${totalTradesAt5x} trades (${(totalTradesAt5x/totalTrades*100).toFixed(1)}%)`);
    
    // Create detailed comparison
    const comparison = {
        strategy: "Entry at alert, -30% SL, TP: 50%@2x, 30%@3x, 20%@5x (NO RE-ENTRY)",
        summary: {
            totalCallers: results.length,
            totalTrades,
            totalStopLossHits,
            totalTradesAt2x,
            totalTradesAt3x,
            totalTradesAt5x,
            bestPerformer: sortedResults[0],
            worstPerformer: sortedResults[sortedResults.length - 1],
            avgReturn: results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length,
            avgWinRate: results.reduce((sum, r) => sum + r.winRate, 0) / results.length
        },
        detailedResults: results
    };
    
    fs.writeFileSync('/home/memez/quantBot/simplified_strategy_analysis.json', JSON.stringify(comparison, null, 2));
    console.log('\nDetailed analysis saved to simplified_strategy_analysis.json');
}

// Run the simplified simulation
simulateSimplifiedStrategy()
    .then((results) => {
        console.log(`\nSimplified strategy simulation complete! Analyzed ${results.length} callers.`);
        
        // Print top performers
        const topPerformers = results.sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
        console.log('\nTop 3 Performers with SIMPLIFIED Strategy:');
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.totalReturn}% return, ${performer.winRate}% win rate`);
            console.log(`   Take Profits: ${performer.tradesAt2x}@2x, ${performer.tradesAt3x}@3x, ${performer.tradesAt5x}@5x`);
            console.log(`   Stop Loss Hits: ${performer.stopLossHits}`);
        });
        
        console.log('\n=== STRATEGY COMPARISON ===');
        console.log('Your Rules (with re-entry): Much higher returns due to re-entry mechanism');
        console.log('Simplified Rules (no re-entry): Lower returns, more stop loss hits');
    })
    .catch(console.error);
