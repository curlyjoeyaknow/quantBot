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
            { level: 5.0, probability: 0.30 }, // 30% chance at  5x (400% gain)  
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

// RISK MANAGEMENT RULES (WEEKLY REBALANCING WITH 2.5% COMPOUNDING)
const RISK_MANAGEMENT_RULES = {
    initialPortfolioSize: 3500, // $3,500 USD initial portfolio
    positionSizePercent: 0.025, // 2.5% of portfolio value per trade
    maxRiskPerTrade: 0.02, // 2% max risk per trade
    reentryStopLoss: 0.40, // 40% stop loss on re-entry
    slippage: 0.05, // 5% slippage
    
    // YOUR STRATEGY
    entryAtAlert: true,
    initialStopLoss: 0.15, // -15% stop loss
    reentryAt: 0.65, // Re-enter at -65% of original alert
    
    // WEEKLY REBALANCING
    rebalanceWeekly: true,
    minPositionSize: 10, // Minimum $10 per trade
};

async function simulateWeeklyRebalancedProfitTargetVariations() {
    const inputFile = '/home/memez/quantBot/final_complete_filtered_ca_drops.csv';
    const allResults = {};
    
    console.log('Testing PROFIT TARGET VARIATIONS with WEEKLY REBALANCING (July 30 - November, 2025)...');
    console.log(`Initial Portfolio Size: $${RISK_MANAGEMENT_RULES.initialPortfolioSize}`);
    console.log(`Position Size: ${RISK_MANAGEMENT_RULES.positionSizePercent * 100}% of portfolio value per trade`);
    console.log(`Max Risk Per Trade: ${RISK_MANAGEMENT_RULES.maxRiskPerTrade * 100}%`);
    console.log(`Time Period: July 30 - November, 2025 (~120+ days)`);
    console.log(`Rebalancing: Weekly (every 7 days)`);
    
    // Test each profit target strategy
    for (const [strategyKey, strategy] of Object.entries(PROFIT_TARGET_STRATEGIES)) {
        console.log(`\n=== Testing ${strategy.name} ===`);
        
        const results = await simulateStrategyWeeklyRebalanced(inputFile, strategy);
        allResults[strategyKey] = {
            strategy: strategy,
            results: results
        };
        
        // Print top 3 performers for this strategy
        const topPerformers = results.sort((a, b) => b.finalPortfolioValue - a.finalPortfolioValue).slice(0, 3);
        console.log(`\nTop 3 Performers:`);
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.totalReturn}% return, Final Value: $${performer.finalPortfolioValue}`);
        });
        
        const totalReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
        const finalPortfolioValue = results.reduce((sum, r) => sum + r.finalPortfolioValue, 0);
        console.log(`Average Return: ${totalReturn.toFixed(2)}%`);
        console.log(`Combined Final Portfolio Value: $${finalPortfolioValue.toFixed(2)}`);
    }
    
    // Create comparison report
    createWeeklyRebalancedComparisonReport(allResults);
    
    return allResults;
}

async function simulateStrategyWeeklyRebalanced(inputFile, strategy) {
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
                    const simulation = simulateCallerWithWeeklyRebalancing(caller, calls, strategy);
                    results.push(simulation);
                });
                
                resolve(results);
            })
            .on('error', reject);
    });
}

function simulateCallerWithWeeklyRebalancing(caller, calls, strategy) {
    let portfolioValue = RISK_MANAGEMENT_RULES.initialPortfolioSize;
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
    
    // Group calls by week
    const weeklyCalls = groupCallsByWeek(calls);
    
    console.log(`  ${caller}: Processing ${weeklyCalls.length} weeks of data`);
    
    // Process each week
    weeklyCalls.forEach((weekCalls, weekIndex) => {
        const weekStartDate = new Date(weekCalls[0]['Timestamp']);
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekEndDate.getDate() + 7);
        
        console.log(`    Week ${weekIndex + 1}: ${weekCalls.length} calls (${weekStartDate.toDateString()} - ${weekEndDate.toDateString()})`);
        
        // Process up to 20 calls per week
        const callsToProcess = weekCalls.slice(0, 20);
        
        callsToProcess.forEach((call, callIndex) => {
            const trade = simulateTradeWithWeeklyRebalancing(call, callIndex, strategy, portfolioValue);
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
        
        // Weekly rebalancing - reset position size based on current portfolio value
        console.log(`    End of Week ${weekIndex + 1}: Portfolio Value: $${portfolioValue.toFixed(2)}`);
    });
    
    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const totalPnL = portfolioValue - RISK_MANAGEMENT_RULES.initialPortfolioSize;
    const totalReturn = (totalPnL / RISK_MANAGEMENT_RULES.initialPortfolioSize) * 100;
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
        finalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        weeklyRebalancing: true
    };
}

function groupCallsByWeek(calls) {
    const weeklyGroups = [];
    let currentWeek = [];
    let currentWeekStart = null;
    
    calls.forEach(call => {
        const callDate = new Date(call['Timestamp']);
        
        if (!currentWeekStart) {
            currentWeekStart = new Date(callDate);
            currentWeekStart.setHours(0, 0, 0, 0);
        }
        
        const weekStart = new Date(currentWeekStart);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        
        if (callDate >= weekStart && callDate < weekEnd) {
            currentWeek.push(call);
        } else {
            if (currentWeek.length > 0) {
                weeklyGroups.push([...currentWeek]);
            }
            currentWeek = [call];
            currentWeekStart = new Date(callDate);
            currentWeekStart.setHours(0, 0, 0, 0);
        }
    });
    
    if (currentWeek.length > 0) {
        weeklyGroups.push(currentWeek);
    }
    
    return weeklyGroups;
}

function simulateTradeWithWeeklyRebalancing(call, tradeIndex, strategy, currentPortfolioValue) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Calculate position size as 2.5% of current portfolio value
    const positionSize = Math.max(
        currentPortfolioValue * RISK_MANAGEMENT_RULES.positionSizePercent,
        RISK_MANAGEMENT_RULES.minPositionSize
    );
    
    if (positionSize < RISK_MANAGEMENT_RULES.minPositionSize) {
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
    let trade = attemptInitialEntryWithWeeklyRebalancing(call, actualEntryPrice, positionSize, holdTime, tradeIndex, false, strategy);
    
    // If initial entry hits stop loss, try re-entry
    if (trade && trade.exitReason === 'stop_loss') {
        const reentryPrice = alertPrice * RISK_MANAGEMENT_RULES.reentryAt; // -65% of original
        const actualReentryPrice = reentryPrice * slippageMultiplier;
        
        // Try re-entry with 40% stop loss
        trade = attemptReentryWithWeeklyRebalancing(call, actualReentryPrice, positionSize, holdTime, tradeIndex, true, strategy);
    }
    
    return trade;
}

function attemptInitialEntryWithWeeklyRebalancing(call, entryPrice, positionSize, holdTime, tradeIndex, isReentry, strategy) {
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

function attemptReentryWithWeeklyRebalancing(call, reentryPrice, positionSize, holdTime, tradeIndex, isReentry, strategy) {
    return attemptInitialEntryWithWeeklyRebalancing(call, reentryPrice, positionSize, holdTime, tradeIndex, true, strategy);
}

function createWeeklyRebalancedComparisonReport(allResults) {
    console.log('\n=== WEEKLY REBALANCED PROFIT TARGET STRATEGY COMPARISON ===');
    console.log('Time Period: July 30 - November, 2025 (~120+ days)');
    console.log('WEEKLY REBALANCING with 2.5% of portfolio value per trade!');
    
    const comparison = [];
    
    Object.entries(allResults).forEach(([strategyKey, data]) => {
        const results = data.results;
        const avgReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
        const totalFinalValue = results.reduce((sum, r) => sum + r.finalPortfolioValue, 0);
        const totalTrades = results.reduce((sum, r) => sum + r.tradesExecuted, 0);
        const totalReentries = results.reduce((sum, r) => sum + r.reentries, 0);
        const totalTradesAt2x = results.reduce((sum, r) => sum + r.tradesAt2x, 0);
        const totalTradesAt3x = results.reduce((sum, r) => sum + r.tradesAt3x, 0);
        const totalTradesAt5x = results.reduce((sum, r) => sum + r.tradesAt5x, 0);
        const totalTradesAt10x = results.reduce((sum, r) => sum + r.tradesAt10x, 0);
        
        const bestPerformer = results.sort((a, b) => b.finalPortfolioValue - a.finalPortfolioValue)[0];
        
        comparison.push({
            strategy: data.strategy.name,
            avgReturn: parseFloat(avgReturn.toFixed(2)),
            totalFinalValue: parseFloat(totalFinalValue.toFixed(2)),
            totalTrades,
            totalReentries,
            reentryRate: parseFloat((totalReentries / totalTrades * 100).toFixed(1)),
            tradesAt2x: totalTradesAt2x,
            tradesAt3x: totalTradesAt3x,
            tradesAt5x: totalTradesAt5x,
            tradesAt10x: totalTradesAt10x,
            bestPerformer: bestPerformer.caller,
            bestReturn: parseFloat(bestPerformer.totalReturn.toFixed(2)),
            bestFinalValue: parseFloat(bestPerformer.finalPortfolioValue.toFixed(2))
        });
    });
    
    // Sort by total final value
    comparison.sort((a, b) => b.totalFinalValue - a.totalFinalValue);
    
    // Create data table
    console.log('\n📊 PROFIT TARGET STRATEGY COMPARISON TABLE');
    console.log('='.repeat(120));
    console.log('| Strategy'.padEnd(25) + '| Avg Return'.padEnd(15) + '| Total Final Value'.padEnd(20) + '| Total Trades'.padEnd(15) + '| Re-entry Rate'.padEnd(15) + '| Best Performer'.padEnd(20) + '|');
    console.log('='.repeat(120));
    
    comparison.forEach((strategy, index) => {
        const strategyName = strategy.strategy.length > 24 ? strategy.strategy.substring(0, 21) + '...' : strategy.strategy;
        const avgReturn = strategy.avgReturn.toLocaleString() + '%';
        const totalValue = '$' + strategy.totalFinalValue.toLocaleString();
        const totalTrades = strategy.totalTrades.toString();
        const reentryRate = strategy.reentryRate + '%';
        const bestPerformer = strategy.bestPerformer.length > 19 ? strategy.bestPerformer.substring(0, 16) + '...' : strategy.bestPerformer;
        
        console.log('| ' + strategyName.padEnd(23) + '| ' + avgReturn.padEnd(13) + '| ' + totalValue.padEnd(18) + '| ' + totalTrades.padEnd(13) + '| ' + reentryRate.padEnd(13) + '| ' + bestPerformer.padEnd(18) + '|');
    });
    
    console.log('='.repeat(120));
    
    // Additional detailed breakdown
    console.log('\n📈 TAKE PROFIT BREAKDOWN');
    console.log('='.repeat(80));
    console.log('| Strategy'.padEnd(25) + '| 2x Trades'.padEnd(12) + '| 3x Trades'.padEnd(12) + '| 5x Trades'.padEnd(12) + '| 10x Trades'.padEnd(12) + '|');
    console.log('='.repeat(80));
    
    comparison.forEach((strategy) => {
        const strategyName = strategy.strategy.length > 24 ? strategy.strategy.substring(0, 21) + '...' : strategy.strategy;
        console.log('| ' + strategyName.padEnd(23) + '| ' + strategy.tradesAt2x.toString().padEnd(10) + '| ' + strategy.tradesAt3x.toString().padEnd(10) + '| ' + strategy.tradesAt5x.toString().padEnd(10) + '| ' + strategy.tradesAt10x.toString().padEnd(10) + '|');
    });
    
    console.log('='.repeat(80));
    
    // Save detailed comparison
    fs.writeFileSync('/home/memez/quantBot/weekly_rebalanced_2_5_percent_comparison.json', JSON.stringify({
        strategies: comparison,
        riskManagement: RISK_MANAGEMENT_RULES,
        timePeriod: "July 30 - November, 2025 (~120+ days)",
        rebalancing: "Weekly with 2.5% of portfolio value per trade",
        summary: {
            bestStrategy: comparison[0],
            worstStrategy: comparison[comparison.length - 1],
            totalStrategies: comparison.length
        }
    }, null, 2));
    
    console.log('\nWeekly rebalanced comparison saved to weekly_rebalanced_2_5_percent_comparison.json');
    
    // Create CSV for easy analysis
    const csvWriter = createCsvWriter({
        path: '/home/memez/quantBot/weekly_rebalanced_2_5_percent_comparison.csv',
        header: [
            {id: 'strategy', title: 'Strategy'},
            {id: 'avgReturn', title: 'Average Return (%)'},
            {id: 'totalFinalValue', title: 'Total Final Value ($)'},
            {id: 'totalTrades', title: 'Total Trades'},
            {id: 'totalReentries', title: 'Total Re-entries'},
            {id: 'reentryRate', title: 'Re-entry Rate (%)'},
            {id: 'tradesAt2x', title: 'Trades at 2x'},
            {id: 'tradesAt3x', title: 'Trades at 3x'},
            {id: 'tradesAt5x', title: 'Trades at 5x'},
            {id: 'tradesAt10x', title: 'Trades at 10x'},
            {id: 'bestPerformer', title: 'Best Performer'},
            {id: 'bestReturn', title: 'Best Return (%)'},
            {id: 'bestFinalValue', title: 'Best Final Value ($)'}
        ]
    });
    
    csvWriter.writeRecords(comparison)
        .then(() => {
            console.log('Weekly rebalanced comparison CSV saved to weekly_rebalanced_2_5_percent_comparison.csv');
        })
        .catch(console.error);
}

// Run the weekly rebalanced profit target variations simulation
simulateWeeklyRebalancedProfitTargetVariations()
    .then((allResults) => {
        console.log('\n=== WEEKLY REBALANCED PROFIT TARGET VARIATIONS COMPLETE ===');
        console.log(`Tested ${Object.keys(allResults).length} different profit target strategies with WEEKLY REBALANCING`);
        console.log('Time Period: July 30 - November, 2025 (~120+ days)');
        console.log('Position Size: 2.5% of portfolio value per trade (compounding)');
        console.log('Rebalancing: Weekly (every 7 days)');
        
        // Find the best strategy
        const bestStrategy = Object.entries(allResults).reduce((best, [key, data]) => {
            const totalFinalValue = data.results.reduce((sum, r) => sum + r.finalPortfolioValue, 0);
            return totalFinalValue > best.totalFinalValue ? {key, totalFinalValue, strategy: data.strategy.name} : best;
        }, {totalFinalValue: 0});
        
        console.log(`\nBest Strategy: ${bestStrategy.strategy}`);
        console.log(`Best Total Final Value: $${bestStrategy.totalFinalValue.toFixed(2)}`);
    })
    .catch(console.error);
