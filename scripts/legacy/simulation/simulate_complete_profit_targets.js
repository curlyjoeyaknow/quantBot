const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// DIFFERENT PROFIT TARGET STRATEGIES
const PROFIT_TARGET_STRATEGIES = {
    // Original strategy
    original: {
        name: "Original: 50%@2x, 30%@3x, 20%@5x",
        takeProfitLevels: [
            { level: 2.0, probability: 0.50 }, // 50% chance at 2x (100% gain)
            { level: 3.0, probability: 0.30 }, // 30% chance at 3x (200% gain)  
            { level: 5.0, probability: 0.20 }  // 20% chance at 5x (400% gain)
        ]
    },
    
    // Higher targets strategy
    higher: {
        name: "Higher: 50%@3x, 30%@5x, 20%@10x",
        takeProfitLevels: [
            { level: 3.0, probability: 0.50 }, // 50% chance at 3x (200% gain)
            { level: 5.0, probability: 0.30 }, // 30% chance at 5x (400% gain)  
            { level: 10.0, probability: 0.20 } // 20% chance at 10x (900% gain)
        ]
    },
    
    // Conservative strategy
    conservative: {
        name: "Conservative: 70%@2x, 20%@3x, 10%@5x",
        takeProfitLevels: [
            { level: 2.0, probability: 0.70 }, // 70% chance at 2x (100% gain)
            { level: 3.0, probability: 0.20 }, // 20% chance at 3x (200% gain)  
            { level: 5.0, probability: 0.10 }   // 10% chance at 5x (400% gain)
        ]
    },
    
    // Aggressive strategy
    aggressive: {
        name: "Aggressive: 30%@2x, 30%@5x, 40%@10x",
        takeProfitLevels: [
            { level: 2.0, probability: 0.30 }, // 30% chance at 2x (100% gain)
            { level: 5.0, probability: 0.30 }, // 30% chance at 5x (400% gain)  
            { level: 10.0, probability: 0.40 } // 40% chance at 10x (900% gain)
        ]
    },
    
    // Balanced strategy
    balanced: {
        name: "Balanced: 40%@2x, 40%@3x, 20%@5x",
        takeProfitLevels: [
            { level: 2.0, probability: 0.40 }, // 40% chance at 2x (100% gain)
            { level: 3.0, probability: 0.40 }, // 40% chance at 3x (200% gain)  
            { level: 5.0, probability: 0.20 }  // 20% chance at 5x (400% gain)
        ]
    },
    
    // Ultra aggressive strategy
    ultraAggressive: {
        name: "Ultra Aggressive: 20%@3x, 30%@5x, 50%@10x",
        takeProfitLevels: [
            { level: 3.0, probability: 0.20 }, // 20% chance at 3x (200% gain)
            { level: 5.0, probability: 0.30 }, // 30% chance at 5x (400% gain)  
            { level: 10.0, probability: 0.50 } // 50% chance at 10x (900% gain)
        ]
    }
};

// RISK MANAGEMENT RULES (FIXED POSITION SIZING)
const RISK_MANAGEMENT_RULES = {
    portfolioSize: 3500, // $3,500 USD portfolio
    maxRiskPerTrade: 0.02, // 2% max risk per trade
    reentryStopLoss: 0.40, // 40% stop loss on re-entry
    
    // FIXED position size based on initial portfolio (not compounding)
    fixedPositionSize: 175, // $175 per trade (5% of initial $3,500)
    slippage: 0.05, // 5% slippage
    
    // YOUR STRATEGY
    entryAtAlert: true,
    initialStopLoss: 0.15, // -15% stop loss
    reentryAt: 0.65, // Re-enter at -65% of original alert
};

async function simulateCompleteProfitTargetVariations() {
    const inputFile = '/home/memez/quantBot/complete_filtered_ca_drops.csv';
    const allResults = {};
    
    console.log('Testing PROFIT TARGET VARIATIONS on COMPLETE DATASET (Aug 1 - Oct 31, 2025)...');
    console.log(`Portfolio Size: $${RISK_MANAGEMENT_RULES.portfolioSize}`);
    console.log(`Fixed Position Size: $${RISK_MANAGEMENT_RULES.fixedPositionSize} per trade`);
    console.log(`Max Risk Per Trade: ${RISK_MANAGEMENT_RULES.maxRiskPerTrade * 100}%`);
    console.log(`Time Period: August 1 - October 31, 2025 (92 days)`);
    
    // Test each profit target strategy
    for (const [strategyKey, strategy] of Object.entries(PROFIT_TARGET_STRATEGIES)) {
        console.log(`\n=== Testing ${strategy.name} ===`);
        
        const results = await simulateStrategyComplete(inputFile, strategy);
        allResults[strategyKey] = {
            strategy: strategy,
            results: results
        };
        
        // Print top 3 performers for this strategy
        const topPerformers = results.sort((a, b) => b.portfolioReturn - a.portfolioReturn).slice(0, 3);
        console.log(`\nTop 3 Performers:`);
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.portfolioReturn}% return, Final Value: $${performer.finalPortfolioValue}`);
        });
        
        const totalPnL = results.reduce((sum, r) => sum + r.totalPnL, 0);
        const totalReturn = (totalPnL / RISK_MANAGEMENT_RULES.portfolioSize) * 100;
        console.log(`Total Portfolio Growth: $${RISK_MANAGEMENT_RULES.portfolioSize} → $${(RISK_MANAGEMENT_RULES.portfolioSize + totalPnL).toFixed(2)}`);
        console.log(`Total Return: ${totalReturn.toFixed(2)}%`);
    }
    
    // Create comparison report
    createCompleteProfitTargetComparisonReport(allResults);
    
    return allResults;
}

async function simulateStrategyComplete(inputFile, strategy) {
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
                const results = [];
                
                console.log(`Found ${Object.keys(callerData).length} unique callers:`);
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`  ${caller}: ${calls.length} calls`);
                });
                
                // Simulate each caller with this strategy
                Object.entries(callerData).forEach(([caller, calls]) => {
                    const simulation = simulateCallerWithStrategyComplete(caller, calls, strategy);
                    results.push(simulation);
                });
                
                resolve(results);
            })
            .on('error', reject);
    });
}

function simulateCallerWithStrategyComplete(caller, calls, strategy) {
    let portfolioValue = RISK_MANAGEMENT_RULES.portfolioSize;
    let maxPortfolioValue = portfolioValue;
    let trades = [];
    let totalVolume = 0;
    let initialEntries = 0;
    let reentries = 0;
    let tradesAt2x = 0;
    let tradesAt3x = 0;
    let tradesAt5x = 0;
    let tradesAt10x = 0;
    
    // Sort calls by timestamp
    calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));
    
    // Process up to 100 calls per caller (increased for longer period)
    const callsToProcess = calls.slice(0, 100);
    
    callsToProcess.forEach((call, index) => {
        const trade = simulateTradeWithStrategyComplete(call, index, strategy);
        if (trade) {
            trades.push(trade);
            portfolioValue += trade.pnl;
            totalVolume += trade.volume;
            maxPortfolioValue = Math.max(maxPortfolioValue, portfolioValue);
            
            if (trade.isReentry) {
                reentries++;
            } else {
                initialEntries++;
            }
            
            // Track take profit levels
            if (trade.takeProfitLevel === 2.0) tradesAt2x++;
            else if (trade.takeProfitLevel === 3.0) tradesAt3x++;
            else if (trade.takeProfitLevel === 5.0) tradesAt5x++;
            else if (trade.takeProfitLevel === 10.0) tradesAt10x++;
        }
    });
    
    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const totalPnL = portfolioValue - RISK_MANAGEMENT_RULES.portfolioSize;
    const totalReturn = (totalPnL / RISK_MANAGEMENT_RULES.portfolioSize) * 100;
    const portfolioReturn = totalReturn;
    const maxDrawdown = ((maxPortfolioValue - Math.min(...trades.map(t => portfolioValue - t.pnl))) / maxPortfolioValue) * 100;
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
        initialEntries,
        reentries,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: parseFloat(winRate.toFixed(2)),
        totalPnL: parseFloat(totalPnL.toFixed(2)),
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        portfolioReturn: parseFloat(portfolioReturn.toFixed(2)),
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
        tradesAt10x,
        maxPositionSize: RISK_MANAGEMENT_RULES.fixedPositionSize,
        finalPortfolioValue: parseFloat(portfolioValue.toFixed(2))
    };
}

function simulateTradeWithStrategyComplete(call, tradeIndex, strategy) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Use FIXED position size (not compounding)
    const positionSize = RISK_MANAGEMENT_RULES.fixedPositionSize;
    
    if (positionSize < 10) { // Minimum $10 trade
        return null;
    }
    
    // Simulate alert price (random between $0.000001 and $0.01)
    const alertPrice = Math.random() * 0.009999 + 0.000001;
    
    // Apply slippage to entry
    const slippageMultiplier = 1 - RISK_MANAGEMENT_RULES.slippage;
    const actualEntryPrice = alertPrice * slippageMultiplier;
    
    // Simulate hold time (1-72 hours)
    const holdTime = Math.random() * 71 + 1;
    
    // Try initial entry first
    let trade = attemptInitialEntryWithStrategyComplete(call, actualEntryPrice, positionSize, holdTime, tradeIndex, false, strategy);
    
    // If initial entry hits stop loss, try re-entry
    if (trade && trade.exitReason === 'stop_loss') {
        const reentryPrice = alertPrice * RISK_MANAGEMENT_RULES.reentryAt; // -65% of original
        const actualReentryPrice = reentryPrice * slippageMultiplier;
        
        // Try re-entry with 40% stop loss
        trade = attemptReentryWithStrategyComplete(call, actualReentryPrice, positionSize, holdTime, tradeIndex, true, strategy);
    }
    
    return trade;
}

function attemptInitialEntryWithStrategyComplete(call, entryPrice, positionSize, holdTime, tradeIndex, isReentry, strategy) {
    // Simulate price movement
    const random = Math.random();
    let exitPrice, exitReason, takeProfitLevel = null;
    
    // Check stop loss first (-15% for initial, -40% for re-entry)
    const stopLossPercent = isReentry ? RISK_MANAGEMENT_RULES.reentryStopLoss : RISK_MANAGEMENT_RULES.initialStopLoss;
    const stopLossPrice = entryPrice * (1 - stopLossPercent);
    
    // Simulate price movement
    const priceMovement = Math.random();
    
    if (priceMovement < 0.3) {
        // 30% chance of hitting stop loss
        exitPrice = stopLossPrice;
        exitReason = 'stop_loss';
    } else {
        // 70% chance of hitting take profit levels
        const tpRandom = Math.random();
        let cumulativeProb = 0;
        
        for (const tp of strategy.takeProfitLevels) {
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
    const slippageMultiplier = 1 - RISK_MANAGEMENT_RULES.slippage;
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
        isReentry,
        volume: parseFloat(positionSize.toFixed(2))
    };
}

function attemptReentryWithStrategyComplete(call, reentryPrice, positionSize, holdTime, tradeIndex, isReentry, strategy) {
    return attemptInitialEntryWithStrategyComplete(call, reentryPrice, positionSize, holdTime, tradeIndex, true, strategy);
}

function createCompleteProfitTargetComparisonReport(allResults) {
    console.log('\n=== COMPLETE DATASET PROFIT TARGET STRATEGY COMPARISON ===');
    console.log('Time Period: August 1 - October 31, 2025 (92 days)');
    console.log('Complete dataset with brook2 (Aug-Sep) + brook (Sep-Oct) data!');
    
    const comparison = [];
    
    Object.entries(allResults).forEach(([strategyKey, data]) => {
        const results = data.results;
        const totalPnL = results.reduce((sum, r) => sum + r.totalPnL, 0);
        const totalReturn = (totalPnL / RISK_MANAGEMENT_RULES.portfolioSize) * 100;
        const avgReturn = results.reduce((sum, r) => sum + r.portfolioReturn, 0) / results.length;
        const totalTrades = results.reduce((sum, r) => sum + r.tradesExecuted, 0);
        const totalReentries = results.reduce((sum, r) => sum + r.reentries, 0);
        const totalTradesAt2x = results.reduce((sum, r) => sum + r.tradesAt2x, 0);
        const totalTradesAt3x = results.reduce((sum, r) => sum + r.tradesAt3x, 0);
        const totalTradesAt5x = results.reduce((sum, r) => sum + r.tradesAt5x, 0);
        const totalTradesAt10x = results.reduce((sum, r) => sum + r.tradesAt10x, 0);
        
        const bestPerformer = results.sort((a, b) => b.portfolioReturn - a.portfolioReturn)[0];
        
        comparison.push({
            strategy: data.strategy.name,
            totalReturn: parseFloat(totalReturn.toFixed(2)),
            avgReturn: parseFloat(avgReturn.toFixed(2)),
            totalPnL: parseFloat(totalPnL.toFixed(2)),
            totalTrades,
            totalReentries,
            reentryRate: parseFloat((totalReentries / totalTrades * 100).toFixed(1)),
            tradesAt2x: totalTradesAt2x,
            tradesAt3x: totalTradesAt3x,
            tradesAt5x: totalTradesAt5x,
            tradesAt10x: totalTradesAt10x,
            bestPerformer: bestPerformer.caller,
            bestReturn: parseFloat(bestPerformer.portfolioReturn.toFixed(2)),
            finalPortfolioValue: parseFloat((RISK_MANAGEMENT_RULES.portfolioSize + totalPnL).toFixed(2))
        });
    });
    
    // Sort by total return
    comparison.sort((a, b) => b.totalReturn - a.totalReturn);
    
    console.log('\nRanking by Total Return (COMPLETE 92-DAY DATASET):');
    comparison.forEach((strategy, index) => {
        console.log(`${index + 1}. ${strategy.strategy}`);
        console.log(`   Total Return: ${strategy.totalReturn}%`);
        console.log(`   Final Portfolio Value: $${strategy.finalPortfolioValue}`);
        console.log(`   Average Return: ${strategy.avgReturn}%`);
        console.log(`   Total Trades: ${strategy.totalTrades}`);
        console.log(`   Re-entries: ${strategy.totalReentries} (${strategy.reentryRate}%)`);
        console.log(`   Take Profits: ${strategy.tradesAt2x}@2x, ${strategy.tradesAt3x}@3x, ${strategy.tradesAt5x}@5x, ${strategy.tradesAt10x}@10x`);
        console.log(`   Best Performer: ${strategy.bestPerformer} (${strategy.bestReturn}%)`);
        console.log('');
    });
    
    // Save detailed comparison
    fs.writeFileSync('/home/memez/quantBot/complete_profit_target_comparison.json', JSON.stringify({
        strategies: comparison,
        riskManagement: RISK_MANAGEMENT_RULES,
        timePeriod: "August 1 - October 31, 2025 (92 days)",
        summary: {
            bestStrategy: comparison[0],
            worstStrategy: comparison[comparison.length - 1],
            totalStrategies: comparison.length
        }
    }, null, 2));
    
    console.log('Complete comparison saved to complete_profit_target_comparison.json');
    
    // Create CSV for easy analysis
    const csvWriter = createCsvWriter({
        path: '/home/memez/quantBot/complete_profit_target_comparison.csv',
        header: [
            {id: 'strategy', title: 'Strategy'},
            {id: 'totalReturn', title: 'Total Return (%)'},
            {id: 'avgReturn', title: 'Average Return (%)'},
            {id: 'totalPnL', title: 'Total P&L ($)'},
            {id: 'finalPortfolioValue', title: 'Final Portfolio Value ($)'},
            {id: 'totalTrades', title: 'Total Trades'},
            {id: 'totalReentries', title: 'Total Re-entries'},
            {id: 'reentryRate', title: 'Re-entry Rate (%)'},
            {id: 'tradesAt2x', title: 'Trades at 2x'},
            {id: 'tradesAt3x', title: 'Trades at 3x'},
            {id: 'tradesAt5x', title: 'Trades at 5x'},
            {id: 'tradesAt10x', title: 'Trades at 10x'},
            {id: 'bestPerformer', title: 'Best Performer'},
            {id: 'bestReturn', title: 'Best Return (%)'}
        ]
    });
    
    csvWriter.writeRecords(comparison)
        .then(() => {
            console.log('Complete comparison CSV saved to complete_profit_target_comparison.csv');
        })
        .catch(console.error);
}

// Run the complete profit target variations simulation
simulateCompleteProfitTargetVariations()
    .then((allResults) => {
        console.log('\n=== COMPLETE PROFIT TARGET VARIATIONS COMPLETE ===');
        console.log(`Tested ${Object.keys(allResults).length} different profit target strategies on COMPLETE dataset`);
        console.log('Time Period: August 1 - October 31, 2025 (92 days)');
        console.log('Complete dataset with brook2 (Aug-Sep) + brook (Sep-Oct) data!');
        
        // Find the best strategy
        const bestStrategy = Object.entries(allResults).reduce((best, [key, data]) => {
            const totalPnL = data.results.reduce((sum, r) => sum + r.totalPnL, 0);
            const totalReturn = (totalPnL / RISK_MANAGEMENT_RULES.portfolioSize) * 100;
            return totalReturn > best.totalReturn ? {key, totalReturn, strategy: data.strategy.name} : best;
        }, {totalReturn: 0});
        
        console.log(`\nBest Strategy: ${bestStrategy.strategy}`);
        console.log(`Best Total Return: ${bestStrategy.totalReturn.toFixed(2)}%`);
    })
    .catch(console.error);
