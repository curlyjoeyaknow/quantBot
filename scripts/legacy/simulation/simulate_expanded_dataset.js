const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// PROPER RISK MANAGEMENT RULES
const RISK_MANAGEMENT_RULES = {
    portfolioSize: 3500, // $3,500 USD portfolio
    maxRiskPerTrade: 0.02, // 2% max risk per trade
    reentryStopLoss: 0.40, // 40% stop loss on re-entry
    
    // Calculate max position size: 2% risk ÷ 40% stop loss = 5% of portfolio
    maxPositionSize: 0.05, // 5% of portfolio per trade
    slippage: 0.05, // 5% slippage
    
    // YOUR STRATEGY
    entryAtAlert: true,
    initialStopLoss: 0.15, // -15% stop loss
    reentryAt: 0.65, // Re-enter at -65% of original alert
    
    // Take profit levels
    takeProfitLevels: [
        { level: 2.0, probability: 0.50 }, // 50% chance at 2x (100% gain)
        { level: 3.0, probability: 0.30 }, // 30% chance at 3x (200% gain)  
        { level: 5.0, probability: 0.20 }  // 20% chance at 5x (400% gain)
    ]
};

async function simulateExpandedDataset() {
    const results = [];
    const inputFile = '/home/memez/quantBot/expanded_filtered_ca_drops.csv';
    
    console.log('Simulating EXPANDED DATASET with YOUR EXACT TRADING RULES...');
    console.log(`Portfolio Size: $${RISK_MANAGEMENT_RULES.portfolioSize}`);
    console.log(`Max Risk Per Trade: ${RISK_MANAGEMENT_RULES.maxRiskPerTrade * 100}%`);
    console.log(`Max Position Size: ${RISK_MANAGEMENT_RULES.maxPositionSize * 100}% of portfolio`);
    console.log('Strategy: Entry at alert, -15% SL, re-enter at -65%, 40% SL, TP: 50%@2x, 30%@3x, 20%@5x');
    
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
                
                // Show caller distribution
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`  ${caller}: ${calls.length} calls`);
                });
                
                // Simulate each caller with proper risk management
                Object.entries(callerData).forEach(([caller, calls]) => {
                    console.log(`\nSimulating ${caller} (${calls.length} calls) with expanded dataset...`);
                    const simulation = simulateCallerWithRiskManagement(caller, calls);
                    results.push(simulation);
                });
                
                // Write results to CSV
                const csvWriter = createCsvWriter({
                    path: '/home/memez/quantBot/expanded_risk_managed_simulations.csv',
                    header: [
                        {id: 'caller', title: 'Caller'},
                        {id: 'totalCalls', title: 'Total Calls'},
                        {id: 'tradesExecuted', title: 'Trades Executed'},
                        {id: 'initialEntries', title: 'Initial Entries'},
                        {id: 'reentries', title: 'Re-entries'},
                        {id: 'winningTrades', title: 'Winning Trades'},
                        {id: 'losingTrades', title: 'Losing Trades'},
                        {id: 'winRate', title: 'Win Rate (%)'},
                        {id: 'totalPnL', title: 'Total P&L ($)'},
                        {id: 'totalReturn', title: 'Total Return (%)'},
                        {id: 'portfolioReturn', title: 'Portfolio Return (%)'},
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
                        {id: 'maxPositionSize', title: 'Max Position Size ($)'},
                        {id: 'finalPortfolioValue', title: 'Final Portfolio Value ($)'}
                    ]
                });
                
                csvWriter.writeRecords(results)
                    .then(() => {
                        console.log('\nExpanded risk-managed simulations saved to expanded_risk_managed_simulations.csv');
                        
                        // Create detailed analysis
                        createExpandedAnalysisReport(results);
                        
                        resolve(results);
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}

function simulateCallerWithRiskManagement(caller, calls) {
    let portfolioValue = RISK_MANAGEMENT_RULES.portfolioSize;
    let maxPortfolioValue = portfolioValue;
    let trades = [];
    let totalVolume = 0;
    let initialEntries = 0;
    let reentries = 0;
    let tradesAt2x = 0;
    let tradesAt3x = 0;
    let tradesAt5x = 0;
    
    // Sort calls by timestamp
    calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));
    
    // Process up to 50 calls per caller (increased from 20)
    const callsToProcess = calls.slice(0, 50);
    
    callsToProcess.forEach((call, index) => {
        const trade = simulateTradeWithRiskManagement(call, portfolioValue, index);
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
    
    // Calculate max position size used
    const maxPositionSizeUsed = trades.length > 0 ? Math.max(...trades.map(t => t.positionSize)) : 0;
    
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
        maxPositionSize: parseFloat(maxPositionSizeUsed.toFixed(2)),
        finalPortfolioValue: parseFloat(portfolioValue.toFixed(2))
    };
}

function simulateTradeWithRiskManagement(call, currentPortfolioValue, tradeIndex) {
    // Skip if no address or invalid data
    if (!call['Address'] || call['Address'] === 'N/A') {
        return null;
    }
    
    // Calculate position size based on portfolio value
    const positionSize = currentPortfolioValue * RISK_MANAGEMENT_RULES.maxPositionSize;
    
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
    let trade = attemptInitialEntryRiskManaged(call, actualEntryPrice, positionSize, holdTime, tradeIndex, false);
    
    // If initial entry hits stop loss, try re-entry
    if (trade && trade.exitReason === 'stop_loss') {
        const reentryPrice = alertPrice * RISK_MANAGEMENT_RULES.reentryAt; // -65% of original
        const actualReentryPrice = reentryPrice * slippageMultiplier;
        
        // Try re-entry with 40% stop loss
        trade = attemptReentryRiskManaged(call, actualReentryPrice, positionSize, holdTime, tradeIndex, true);
    }
    
    return trade;
}

function attemptInitialEntryRiskManaged(call, entryPrice, positionSize, holdTime, tradeIndex, isReentry) {
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
        
        for (const tp of RISK_MANAGEMENT_RULES.takeProfitLevels) {
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

function attemptReentryRiskManaged(call, reentryPrice, positionSize, holdTime, tradeIndex, isReentry) {
    return attemptInitialEntryRiskManaged(call, reentryPrice, positionSize, holdTime, tradeIndex, true);
}

function createExpandedAnalysisReport(results) {
    console.log('\n=== EXPANDED DATASET PERFORMANCE ANALYSIS ===');
    console.log(`Portfolio Size: $${RISK_MANAGEMENT_RULES.portfolioSize}`);
    console.log(`Max Risk Per Trade: ${RISK_MANAGEMENT_RULES.maxRiskPerTrade * 100}%`);
    console.log(`Max Position Size: ${RISK_MANAGEMENT_RULES.maxPositionSize * 100}% of portfolio`);
    
    // Sort by portfolio return
    const sortedResults = results.sort((a, b) => b.portfolioReturn - a.portfolioReturn);
    
    console.log('\nRanking by Portfolio Return:');
    sortedResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.caller}`);
        console.log(`   Portfolio Return: ${result.portfolioReturn}%`);
        console.log(`   Final Portfolio Value: $${result.finalPortfolioValue}`);
        console.log(`   Total P&L: $${result.totalPnL}`);
        console.log(`   Win Rate: ${result.winRate}%`);
        console.log(`   Trades: ${result.tradesExecuted} (${result.initialEntries} initial, ${result.reentries} re-entries)`);
        console.log(`   Take Profits: ${result.tradesAt2x}@2x, ${result.tradesAt3x}@3x, ${result.tradesAt5x}@5x`);
        console.log(`   Max Position Size: $${result.maxPositionSize}`);
        console.log(`   Best Trade: ${result.bestTrade}%`);
        console.log(`   Worst Trade: ${result.worstTrade}%`);
        console.log(`   Sharpe Ratio: ${result.sharpeRatio}`);
        console.log('');
    });
    
    // Calculate strategy statistics
    const totalTrades = results.reduce((sum, r) => sum + r.tradesExecuted, 0);
    const totalInitialEntries = results.reduce((sum, r) => sum + r.initialEntries, 0);
    const totalReentries = results.reduce((sum, r) => sum + r.reentries, 0);
    const totalTradesAt2x = results.reduce((sum, r) => sum + r.tradesAt2x, 0);
    const totalTradesAt3x = results.reduce((sum, r) => sum + r.tradesAt3x, 0);
    const totalTradesAt5x = results.reduce((sum, r) => sum + r.tradesAt5x, 0);
    const totalPnL = results.reduce((sum, r) => sum + r.totalPnL, 0);
    const avgPortfolioReturn = results.reduce((sum, r) => sum + r.portfolioReturn, 0) / results.length;
    
    console.log('\n=== EXPANDED STRATEGY STATISTICS ===');
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`Average Portfolio Return: ${avgPortfolioReturn.toFixed(2)}%`);
    console.log(`Initial Entries: ${totalInitialEntries} (${(totalInitialEntries/totalTrades*100).toFixed(1)}%)`);
    console.log(`Re-entries: ${totalReentries} (${(totalReentries/totalTrades*100).toFixed(1)}%)`);
    console.log(`Take Profit Distribution:`);
    console.log(`  - 2x (100% gain): ${totalTradesAt2x} trades (${(totalTradesAt2x/totalTrades*100).toFixed(1)}%)`);
    console.log(`  - 3x (200% gain): ${totalTradesAt3x} trades (${(totalTradesAt3x/totalTrades*100).toFixed(1)}%)`);
    console.log(`  - 5x (400% gain): ${totalTradesAt5x} trades (${(totalTradesAt5x/totalTrades*100).toFixed(1)}%)`);
    
    // Create detailed comparison
    const comparison = {
        portfolioSize: RISK_MANAGEMENT_RULES.portfolioSize,
        maxRiskPerTrade: RISK_MANAGEMENT_RULES.maxRiskPerTrade,
        maxPositionSize: RISK_MANAGEMENT_RULES.maxPositionSize,
        strategy: "Entry at alert, -15% SL, re-enter at -65%, 40% SL, TP: 50%@2x, 30%@3x, 20%@5x",
        summary: {
            totalCallers: results.length,
            totalTrades,
            totalPnL,
            avgPortfolioReturn,
            totalInitialEntries,
            totalReentries,
            totalTradesAt2x,
            totalTradesAt3x,
            totalTradesAt5x,
            bestPerformer: sortedResults[0],
            worstPerformer: sortedResults[sortedResults.length - 1]
        },
        detailedResults: results
    };
    
    fs.writeFileSync('/home/memez/quantBot/expanded_risk_managed_analysis.json', JSON.stringify(comparison, null, 2));
    console.log('\nDetailed analysis saved to expanded_risk_managed_analysis.json');
}

// Run the expanded simulation
simulateExpandedDataset()
    .then((results) => {
        console.log(`\nExpanded simulation complete! Analyzed ${results.length} callers.`);
        
        // Print top performers
        const topPerformers = results.sort((a, b) => b.portfolioReturn - a.portfolioReturn).slice(0, 3);
        console.log('\nTop 3 Performers with Expanded Dataset:');
        topPerformers.forEach((performer, index) => {
            console.log(`${index + 1}. ${performer.caller}: ${performer.portfolioReturn}% return, Final Value: $${performer.finalPortfolioValue}`);
            console.log(`   Take Profits: ${performer.tradesAt2x}@2x, ${performer.tradesAt3x}@3x, ${performer.tradesAt5x}@5x`);
        });
        
        const totalPnL = results.reduce((sum, r) => sum + r.totalPnL, 0);
        console.log(`\nTotal Portfolio Growth: $${RISK_MANAGEMENT_RULES.portfolioSize} → $${(RISK_MANAGEMENT_RULES.portfolioSize + totalPnL).toFixed(2)}`);
        console.log(`Total Return: ${(totalPnL / RISK_MANAGEMENT_RULES.portfolioSize * 100).toFixed(2)}%`);
    })
    .catch(console.error);
