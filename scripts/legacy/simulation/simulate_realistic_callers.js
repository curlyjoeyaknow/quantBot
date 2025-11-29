const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// More realistic simulation parameters
const REALISTIC_SIMULATION_CONFIG = {
    initialBalance: 1000, // Starting with $1000
    maxPositionSize: 0.1, // Max 10% of balance per trade
    stopLoss: 0.3, // 30% stop loss (more realistic)
    takeProfit: 0.5, // 50% take profit (more realistic)
    maxTrades: 10, // Max trades per caller
    slippage: 0.05, // 5% slippage
    // More realistic exit scenarios
    exitScenarios: {
        stopLoss: 0.4, // 40% chance of stop loss
        takeProfit: 0.2, // 20% chance of take profit
        smallLoss: 0.2, // 20% chance of small loss (-5% to -15%)
        smallGain: 0.15, // 15% chance of small gain (+5% to +25%)
        bigLoss: 0.05 // 5% chance of big loss (-30% to -80%)
    }
};

async function simulateCallerPerformanceRealistic() {
    const results = [];
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv';
    
    console.log('Reading filtered CA drops data with realistic parameters...');
    
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
                
                // Simulate each caller separately with realistic parameters
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`\nSimulating ${caller} (${calls.length} calls) with realistic parameters...`);
                    const simulation = simulateCallerRealistic(caller, calls);
                    results.push(simulation);
                });
                
                // Write results to CSV
                const csvWriter = createCsvWriter({
                    path: '/home/memez/quantBot/realistic_caller_simulations.csv',
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
                        console.log('\nRealistic caller simulations saved to realistic_caller_simulations.csv');
                        
                        // Create comparison
                        createRealisticComparisonReport(results);
                        
                        resolve(results);
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}

function simulateCallerRealistic(caller, calls) {
    let balance = REALISTIC_SIMULATION_CONFIG.initialBalance;
    let maxBalance = balance;
    let trades = [];
    let totalVolume = 0;
    
    // Sort calls by timestamp
    calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));
    
    // Limit to max trades
    const callsToProcess = calls.slice(0, REALISTIC_SIMULATION_CONFIG.maxTrades);
    
    callsToProcess.forEach((call, index) => {
        const trade = simulateTradeRealistic(call, balance, index);
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
    const totalPnL = balance - REALISTIC_SIMULATION_CONFIG.initialBalance;
    const totalReturn = (totalPnL / REALISTIC_SIMULATION_CONFIG.initialBalance) * 100;
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
        totalVolume: parseFloat(totalVolume.toFixed(2))
    };
}

function simulateTradeRealistic(call, currentBalance, tradeIndex) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Calculate position size
    const positionSize = Math.min(
        currentBalance * REALISTIC_SIMULATION_CONFIG.maxPositionSize,
        currentBalance * 0.1 // Max 10% per trade
    );
    
    if (positionSize < 10) { // Minimum $10 trade
        return null;
    }
    
    // Simulate entry price (random between $0.000001 and $0.01)
    const entryPrice = Math.random() * 0.009999 + 0.000001;
    
    // Simulate hold time (1-48 hours)
    const holdTime = Math.random() * 47 + 1;
    
    // Simulate realistic exit scenarios
    const random = Math.random();
    let exitPrice, exitReason, priceChange;
    
    if (random < REALISTIC_SIMULATION_CONFIG.exitScenarios.stopLoss) {
        // 40% chance of stop loss (-30%)
        priceChange = -REALISTIC_SIMULATION_CONFIG.stopLoss;
        exitReason = 'stop_loss';
    } else if (random < REALISTIC_SIMULATION_CONFIG.exitScenarios.stopLoss + REALISTIC_SIMULATION_CONFIG.exitScenarios.takeProfit) {
        // 20% chance of take profit (+50%)
        priceChange = REALISTIC_SIMULATION_CONFIG.takeProfit;
        exitReason = 'take_profit';
    } else if (random < REALISTIC_SIMULATION_CONFIG.exitScenarios.stopLoss + REALISTIC_SIMULATION_CONFIG.exitScenarios.takeProfit + REALISTIC_SIMULATION_CONFIG.exitScenarios.smallLoss) {
        // 20% chance of small loss (-5% to -15%)
        priceChange = -(Math.random() * 0.1 + 0.05);
        exitReason = 'small_loss';
    } else if (random < REALISTIC_SIMULATION_CONFIG.exitScenarios.stopLoss + REALISTIC_SIMULATION_CONFIG.exitScenarios.takeProfit + REALISTIC_SIMULATION_CONFIG.exitScenarios.smallLoss + REALISTIC_SIMULATION_CONFIG.exitScenarios.smallGain) {
        // 15% chance of small gain (+5% to +25%)
        priceChange = Math.random() * 0.2 + 0.05;
        exitReason = 'small_gain';
    } else {
        // 5% chance of big loss (-30% to -80%)
        priceChange = -(Math.random() * 0.5 + 0.3);
        exitReason = 'big_loss';
    }
    
    exitPrice = entryPrice * (1 + priceChange);
    
    // Apply slippage
    const slippageMultiplier = 1 - REALISTIC_SIMULATION_CONFIG.slippage;
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

function createRealisticComparisonReport(results) {
    console.log('\n=== REALISTIC CALLER PERFORMANCE COMPARISON ===');
    
    // Sort by total return
    const sortedResults = results.sort((a, b) => b.totalReturn - a.totalReturn);
    
    console.log('\nRanking by Total Return (Realistic Parameters):');
    sortedResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.caller}`);
        console.log(`   Total Return: ${result.totalReturn}%`);
        console.log(`   Win Rate: ${result.winRate}%`);
        console.log(`   Trades: ${result.tradesExecuted}/${result.totalCalls}`);
        console.log(`   P&L: $${result.totalPnL}`);
        console.log(`   Best Trade: ${result.bestTrade}%`);
        console.log(`   Worst Trade: ${result.worstTrade}%`);
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
            avgWinRate: results.reduce((sum, r) => sum + r.winRate, 0) / results.length,
            maxBestTrade: Math.max(...results.map(r => r.bestTrade)),
            minWorstTrade: Math.min(...results.map(r => r.worstTrade))
        },
        detailedResults: results
    };
    
    fs.writeFileSync('/home/memez/quantBot/realistic_caller_comparison.json', JSON.stringify(comparison, null, 2));
    console.log('Realistic comparison saved to realistic_caller_comparison.json');
}

// Run the realistic simulation
simulateCallerPerformanceRealistic()
    .then((results) => {
        console.log(`\nRealistic simulation complete! Analyzed ${results.length} callers.`);
        
        // Print top performers
        const topPerformers = results.sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
        console.log('\nTop 3 Performers (Realistic Parameters):');
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.totalReturn}% return, ${performer.winRate}% win rate, best trade: ${performer.bestTrade}%`);
        });
        
        console.log(`\nMaximum best trade across all callers: ${Math.max(...results.map(r => r.bestTrade))}%`);
        console.log(`Minimum worst trade across all callers: ${Math.min(...results.map(r => r.worstTrade))}%`);
    })
    .catch(console.error);
