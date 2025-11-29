const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Simulation parameters
const SIMULATION_CONFIG = {
    initialBalance: 1000, // Starting with $1000
    maxPositionSize: 0.1, // Max 10% of balance per trade
    stopLoss: 0.5, // 50% stop loss
    takeProfit: 2.0, // 200% take profit
    maxTrades: 10, // Max trades per caller
    slippage: 0.05 // 5% slippage
};

async function simulateCallerPerformance() {
    const results = [];
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv';
    
    console.log('Reading filtered CA drops data...');
    
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
                
                // Simulate each caller separately
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`\nSimulating ${caller} (${calls.length} calls)...`);
                    const simulation = simulateCaller(caller, calls);
                    results.push(simulation);
                });
                
                // Write results to CSV
                const csvWriter = createCsvWriter({
                    path: '/home/memez/quantBot/individual_caller_simulations.csv',
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
                        {id: 'totalVolume', title: 'Total Volume ($)'}
                    ]
                });
                
                csvWriter.writeRecords(results)
                    .then(() => {
                        console.log('\nIndividual caller simulations saved to individual_caller_simulations.csv');
                        
                        // Create summary analysis
                        createCallerComparisonReport(results);
                        
                        resolve(results);
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}

function simulateCaller(caller, calls) {
    let balance = SIMULATION_CONFIG.initialBalance;
    let maxBalance = balance;
    let trades = [];
    let totalVolume = 0;
    
    // Sort calls by timestamp
    calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));
    
    // Limit to max trades
    const callsToProcess = calls.slice(0, SIMULATION_CONFIG.maxTrades);
    
    callsToProcess.forEach((call, index) => {
        const trade = simulateTrade(call, balance, index);
        if (trade) {
            trades.push(trade);
            balance += trade.pnl;
            totalVolume += trade.volume;
            maxBalance = Math.max(maxBalance, balance);
        }
    });
    
    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const totalPnL = balance - SIMULATION_CONFIG.initialBalance;
    const totalReturn = (totalPnL / SIMULATION_CONFIG.initialBalance) * 100;
    const maxDrawdown = ((maxBalance - Math.min(...trades.map(t => balance - t.pnl))) / maxBalance) * 100;
    const avgTradeReturn = trades.length > 0 ? trades.reduce((sum, t) => sum + t.return, 0) / trades.length : 0;
    const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.return)) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.return)) : 0;
    
    // Calculate Sharpe ratio (simplified)
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
        totalVolume: parseFloat(totalVolume.toFixed(2))
    };
}

function simulateTrade(call, currentBalance, tradeIndex) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Calculate position size
    const positionSize = Math.min(
        currentBalance * SIMULATION_CONFIG.maxPositionSize,
        currentBalance * 0.1 // Max 10% per trade
    );
    
    if (positionSize < 10) { // Minimum $10 trade
        return null;
    }
    
    // Simulate entry price (random between $0.000001 and $0.01)
    const entryPrice = Math.random() * 0.009999 + 0.000001;
    
    // Simulate hold time (1-48 hours)
    const holdTime = Math.random() * 47 + 1;
    
    // Simulate exit scenario
    const random = Math.random();
    let exitPrice, exitReason;
    
    if (random < 0.3) {
        // 30% chance of stop loss
        exitPrice = entryPrice * (1 - SIMULATION_CONFIG.stopLoss);
        exitReason = 'stop_loss';
    } else if (random < 0.6) {
        // 30% chance of take profit
        exitPrice = entryPrice * (1 + SIMULATION_CONFIG.takeProfit);
        exitReason = 'take_profit';
    } else {
        // 40% chance of random exit
        const priceChange = (Math.random() - 0.5) * 2; // -100% to +100%
        exitPrice = entryPrice * (1 + priceChange);
        exitReason = 'random_exit';
    }
    
    // Apply slippage
    const slippageMultiplier = 1 - SIMULATION_CONFIG.slippage;
    const actualEntryPrice = entryPrice * slippageMultiplier;
    const actualExitPrice = exitPrice * slippageMultiplier;
    
    // Calculate P&L
    const tokensBought = positionSize / actualEntryPrice;
    const exitValue = tokensBought * actualExitPrice;
    const pnl = exitValue - positionSize;
    const returnPercent = (pnl / positionSize) * 100;
    
    return {
        tradeIndex,
        address: call['Address'],
        tokenName: call['Token Name'] || 'Unknown',
        chain: call['Chain'] || 'Unknown',
        entryPrice: parseFloat(actualEntryPrice.toFixed(8)),
        exitPrice: parseFloat(actualExitPrice.toFixed(8)),
        positionSize: parseFloat(positionSize.toFixed(2)),
        exitValue: parseFloat(exitValue.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        return: parseFloat(returnPercent.toFixed(2)),
        holdTime: parseFloat(holdTime.toFixed(1)),
        exitReason,
        volume: parseFloat(positionSize.toFixed(2))
    };
}

function createCallerComparisonReport(results) {
    console.log('\n=== INDIVIDUAL CALLER PERFORMANCE COMPARISON ===');
    
    // Sort by total return
    const sortedResults = results.sort((a, b) => b.totalReturn - a.totalReturn);
    
    console.log('\nRanking by Total Return:');
    sortedResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.caller}`);
        console.log(`   Total Return: ${result.totalReturn}%`);
        console.log(`   Win Rate: ${result.winRate}%`);
        console.log(`   Trades: ${result.tradesExecuted}/${result.totalCalls}`);
        console.log(`   P&L: $${result.totalPnL}`);
        console.log(`   Sharpe Ratio: ${result.sharpeRatio}`);
        console.log('');
    });
    
    // Create detailed comparison
    const comparison = {
        summary: {
            totalCallers: results.length,
            bestPerformer: sortedResults[0],
            worstPerformer: sortedResults[sortedResults.length - 1],
            avgReturn: results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length,
            avgWinRate: results.reduce((sum, r) => sum + r.winRate, 0) / results.length
        },
        rankings: {
            byReturn: sortedResults.map((r, i) => ({ rank: i + 1, caller: r.caller, return: r.totalReturn })),
            byWinRate: results.sort((a, b) => b.winRate - a.winRate).map((r, i) => ({ rank: i + 1, caller: r.caller, winRate: r.winRate })),
            bySharpe: results.sort((a, b) => b.sharpeRatio - a.sharpeRatio).map((r, i) => ({ rank: i + 1, caller: r.caller, sharpe: r.sharpeRatio }))
        },
        detailedResults: results
    };
    
    fs.writeFileSync('/home/memez/quantBot/caller_performance_comparison.json', JSON.stringify(comparison, null, 2));
    console.log('Detailed comparison saved to caller_performance_comparison.json');
}

// Run the simulation
simulateCallerPerformance()
    .then((results) => {
        console.log(`\nSimulation complete! Analyzed ${results.length} callers.`);
        
        // Print top performers
        const topPerformers = results.sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
        console.log('\nTop 3 Performers:');
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.totalReturn}% return, ${performer.winRate}% win rate`);
        });
    })
    .catch(console.error);
