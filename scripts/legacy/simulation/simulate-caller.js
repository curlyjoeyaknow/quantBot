const fs = require('fs');
const path = require('path');

// Import services
const { callerTracking } = require('../src/services/caller-tracking');
const { ohlcvQuery } = require('../src/services/ohlcv-query');
const { ohlcvIngestion } = require('../src/services/ohlcv-ingestion');

// Configuration
const INITIAL_SOL_BALANCE = 100;
const FIXED_POSITION_SIZE_SOL = 2.5;
const SLIPPAGE_PERCENTAGE = 0.03;
const FEES_PERCENTAGE = 0.005;
const TOTAL_COST_PERCENTAGE = SLIPPAGE_PERCENTAGE + FEES_PERCENTAGE;

// Original trading rules
const TRADING_RULES = {
    entry: 'at_alert',
    stopLoss: 0.30, // -30% stoploss from entry
    reentry: {
        enabled: false // No re-entry
    },
    takeProfit: [
        { percentage: 0.50, multiplier: 2.0 }, // 50% @ 2x
        { percentage: 0.30, multiplier: 3.0 }, // 30% @ 3x
        { percentage: 0.20, multiplier: 5.0 }  // 20% @ 5x
    ]
};

/**
 * Calculate entry rating based on price action in first hour
 */
function calculateEntryRating(ohlcvData, entryPrice) {
    if (!ohlcvData || ohlcvData.length === 0) return 'N/A';
    
    const firstHourData = ohlcvData.slice(0, 60); // First 60 minutes
    if (firstHourData.length === 0) return 'N/A';
    
    const prices = firstHourData.map(candle => candle.close);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    const volatility = ((high - low) / entryPrice) * 100;
    const priceTrend = ((avgPrice - entryPrice) / entryPrice) * 100;
    
    let rating = 'C';
    if (volatility < 5 && priceTrend > 0) rating = 'A';
    else if (volatility < 10 && priceTrend > -2) rating = 'B';
    else if (volatility > 20 || priceTrend < -10) rating = 'D';
    
    return {
        rating,
        volatility: volatility.toFixed(2),
        priceTrend: priceTrend.toFixed(2),
        high: high.toFixed(8),
        low: low.toFixed(8),
        avgPrice: avgPrice.toFixed(8)
    };
}

/**
 * Simulate a single trade using InfluxDB data
 */
async function simulateTrade(alert, currentSOLBalance) {
    const tokenAddress = alert.tokenAddress;
    const alertTimestamp = alert.alertTimestamp;

    console.log(`\n🔄 Processing ${tokenAddress} at ${alertTimestamp.toISOString()}`);

    // Check if data exists in InfluxDB
    const endTime = new Date(alertTimestamp.getTime() + 24 * 60 * 60 * 1000); // 24 hours after alert
    const hasData = await ohlcvQuery.hasData(tokenAddress, alertTimestamp, endTime);

    if (!hasData) {
        console.log(`❌ No OHLCV data found in InfluxDB for ${tokenAddress}`);
        
        // Try to fetch and store data from Birdeye API
        console.log(`🔄 Attempting to fetch data from Birdeye API...`);
        try {
            await ohlcvIngestion.fetchAndStoreOHLCV(
                tokenAddress, 
                alertTimestamp, 
                endTime, 
                alert.tokenSymbol || 'UNKNOWN', 
                alert.chain
            );
            
            // Check again after fetching
            const hasDataAfterFetch = await ohlcvQuery.hasData(tokenAddress, alertTimestamp, endTime);
            if (!hasDataAfterFetch) {
                console.log(`❌ Still no data available for ${tokenAddress} after API fetch`);
                return null;
            }
        } catch (error) {
            console.log(`❌ Failed to fetch data from API for ${tokenAddress}: ${error.message}`);
            return null;
        }
    }

    // Get OHLCV data from InfluxDB
    const ohlcvData = await ohlcvQuery.getOHLCV(tokenAddress, alertTimestamp, endTime);

    if (!ohlcvData || ohlcvData.length === 0) {
        console.log(`❌ No OHLCV data retrieved for ${tokenAddress}`);
        return null;
    }

    // Find the candle closest to the alert time
    const alertTime = alertTimestamp.getTime();
    let entryCandle = ohlcvData[0];
    let entryIndex = 0;
    
    for (let i = 0; i < ohlcvData.length; i++) {
        if (ohlcvData[i].timestamp >= alertTime) {
            entryCandle = ohlcvData[i];
            entryIndex = i;
            break;
        }
    }

    let entryPrice = entryCandle.open;
    let entryTimestamp = entryCandle.dateTime;

    const positionSizeSOL = FIXED_POSITION_SIZE_SOL;
    const totalCostSOL = positionSizeSOL * (1 + TOTAL_COST_PERCENTAGE);

    if (currentSOLBalance < totalCostSOL) {
        console.log(`Insufficient SOL balance (${currentSOLBalance.toFixed(4)} SOL) to open trade costing ${totalCostSOL.toFixed(4)} SOL.`);
        return null;
    }

    const stopLossPrice = entryPrice * (1 - TRADING_RULES.stopLoss);
    const takeProfitLevels = TRADING_RULES.takeProfit.map(tp => ({
        multiplier: tp.multiplier,
        price: entryPrice * tp.multiplier,
        percentage: tp.percentage,
        filledAmountSOL: 0
    }));

    // Calculate entry rating
    const entryRating = calculateEntryRating(ohlcvData.slice(entryIndex), entryPrice);

    console.log(`📊 Entry: $${entryPrice.toFixed(8)}, SL: $${stopLossPrice.toFixed(8)}`);
    console.log(`🎯 Take Profits: ${takeProfitLevels.map(tp => `${tp.multiplier}x@$${tp.price.toFixed(8)}`).join(', ')}`);
    console.log(`📈 Entry Rating: ${entryRating.rating} (Vol: ${entryRating.volatility}%, Trend: ${entryRating.priceTrend}%)`);

    let tradeResult = {
        tokenAddress: tokenAddress,
        alertTimestamp: alertTimestamp.toISOString(),
        entryPrice: entryPrice,
        positionSizeSOL: positionSizeSOL,
        totalCostSOL: totalCostSOL,
        stopLossPrice: stopLossPrice,
        takeProfitLevels: takeProfitLevels.map(tp => ({ ...tp, price: tp.price })),
        exitPrice: null,
        exitTimestamp: null,
        exitReason: 'N/A',
        pnlSOL: 0,
        entryRating: entryRating,
        trades: []
    };

    let currentPositionSOL = positionSizeSOL;
    let currentTakeProfitLevels = takeProfitLevels.map(tp => ({ ...tp }));

    // Process candles from entry point onwards
    const remainingCandles = ohlcvData.slice(entryIndex);
    
    for (const candle of remainingCandles) {
        const high = candle.high;
        const low = candle.low;
        const close = candle.close;
        const candleTime = candle.dateTime;

        if (currentPositionSOL > 0) {
            // Check take profit levels
            for (let i = 0; i < currentTakeProfitLevels.length; i++) {
                const tp = currentTakeProfitLevels[i];
                if (tp.price > 0 && high >= tp.price && tp.filledAmountSOL < tp.percentage * positionSizeSOL) {
                    const amountToTakeProfit = tp.percentage * positionSizeSOL - tp.filledAmountSOL;
                    if (amountToTakeProfit > 0) {
                        const profit = amountToTakeProfit * (tp.multiplier - 1);
                        tradeResult.pnlSOL += profit - (amountToTakeProfit * TOTAL_COST_PERCENTAGE);
                        currentPositionSOL -= amountToTakeProfit;
                        tp.filledAmountSOL += amountToTakeProfit;
                        tradeResult.trades.push({
                            type: 'Take Profit',
                            price: tp.price,
                            timestamp: candleTime.toISOString(),
                            amountSOL: amountToTakeProfit,
                            pnlSOL: profit - (amountToTakeProfit * TOTAL_COST_PERCENTAGE),
                            reason: `${tp.multiplier}x TP hit`
                        });
                        console.log(`  ✅ ${tp.multiplier}x TP hit at $${tp.price.toFixed(8)} on candle ${candleTime.toISOString()}. Remaining position: ${currentPositionSOL.toFixed(4)} SOL`);
                    }
                }
            }

            // Check stop loss
            if (currentPositionSOL > 0 && low <= stopLossPrice) {
                const loss = currentPositionSOL * (entryPrice - stopLossPrice) / entryPrice;
                tradeResult.pnlSOL -= currentPositionSOL * (entryPrice - stopLossPrice) / entryPrice + (currentPositionSOL * TOTAL_COST_PERCENTAGE);
                tradeResult.exitPrice = stopLossPrice;
                tradeResult.exitTimestamp = candleTime.toISOString();
                tradeResult.exitReason = 'stop_loss';
                tradeResult.trades.push({
                    type: 'Stop Loss',
                    price: stopLossPrice,
                    timestamp: candleTime.toISOString(),
                    amountSOL: currentPositionSOL,
                    pnlSOL: -currentPositionSOL * (entryPrice - stopLossPrice) / entryPrice - (currentPositionSOL * TOTAL_COST_PERCENTAGE),
                    reason: 'Stop loss hit'
                });
                currentPositionSOL = 0;
                console.log(`  ❌ Stop loss hit at $${stopLossPrice.toFixed(8)} on candle ${candleTime.toISOString()}. Position closed.`);
                break;
            }

            // Check if all take profits are filled
            const totalFilledTP = currentTakeProfitLevels.reduce((sum, tp) => sum + tp.filledAmountSOL, 0);
            if (totalFilledTP >= positionSizeSOL * 0.99 && currentPositionSOL > 0) {
                const remainingAmount = currentPositionSOL;
                const profit = remainingAmount * (close - entryPrice) / entryPrice;
                tradeResult.pnlSOL += profit - (remainingAmount * TOTAL_COST_PERCENTAGE);
                tradeResult.exitPrice = close;
                tradeResult.exitTimestamp = candleTime.toISOString();
                tradeResult.exitReason = 'all_tps_hit';
                tradeResult.trades.push({
                    type: 'Close Remaining',
                    price: close,
                    timestamp: candleTime.toISOString(),
                    amountSOL: remainingAmount,
                    pnlSOL: profit - (remainingAmount * TOTAL_COST_PERCENTAGE),
                    reason: 'All TPs hit'
                });
                currentPositionSOL = 0;
                console.log(`  🎉 All TPs filled. Remaining position closed at $${close.toFixed(8)} on candle ${candleTime.toISOString()}.`);
                break;
            }
        }
    }

    // If position still open at end of data
    if (currentPositionSOL > 0) {
        const lastCandle = remainingCandles[remainingCandles.length - 1];
        const exitPrice = lastCandle.close;
        const profit = currentPositionSOL * (exitPrice - entryPrice) / entryPrice;
        tradeResult.pnlSOL += profit - (currentPositionSOL * TOTAL_COST_PERCENTAGE);
        tradeResult.exitPrice = exitPrice;
        tradeResult.exitTimestamp = lastCandle.dateTime.toISOString();
        tradeResult.exitReason = 'data_end';
        tradeResult.trades.push({
            type: 'Data End Exit',
            price: exitPrice,
            timestamp: lastCandle.dateTime.toISOString(),
            amountSOL: currentPositionSOL,
            pnlSOL: profit - (currentPositionSOL * TOTAL_COST_PERCENTAGE),
            reason: 'End of available data'
        });
        console.log(`  ⏰ Position closed at end of data: $${exitPrice.toFixed(8)} (PnL: ${tradeResult.pnlSOL.toFixed(4)} SOL)`);
    }

    tradeResult.finalPnlSOL = tradeResult.pnlSOL;
    tradeResult.finalPortfolioValueSOL = currentSOLBalance + tradeResult.finalPnlSOL;

    return tradeResult;
}

/**
 * Run simulation for a specific caller
 */
async function runCallerSimulation(callerName, maxTrades = 20) {
    console.log(`🚀 Running simulation for caller: ${callerName}`);
    console.log(`💰 Fixed position size: ${FIXED_POSITION_SIZE_SOL} SOL per trade`);
    console.log(`🏦 Initial SOL balance: ${INITIAL_SOL_BALANCE} SOL`);

    try {
        // Initialize services
        await callerTracking.initialize();
        await ohlcvIngestion.initialize();

        // Get caller alerts
        const alerts = await callerTracking.getCallerAlerts(callerName, maxTrades);
        
        if (alerts.length === 0) {
            console.log(`❌ No alerts found for caller: ${callerName}`);
            return;
        }

        console.log(`📋 Found ${alerts.length} alerts for ${callerName}`);

        let currentSOLBalance = INITIAL_SOL_BALANCE;
        let allTradeResults = [];
        let tokensWithPriceData = 0;
        let tokensWithoutPriceData = 0;

        // Process alerts
        for (let i = 0; i < alerts.length; i++) {
            const alert = alerts[i];
            console.log(`\n📈 Processing trade ${i + 1}/${alerts.length}: ${alert.tokenAddress}`);
            
            const tradeResult = await simulateTrade(alert, currentSOLBalance);

            if (tradeResult) {
                allTradeResults.push(tradeResult);
                currentSOLBalance += tradeResult.finalPnlSOL;
                tokensWithPriceData++;
            } else {
                tokensWithoutPriceData++;
            }
        }

        // Calculate results
        const totalTrades = allTradeResults.length;
        const winningTrades = allTradeResults.filter(t => t.finalPnlSOL > 0).length;
        const losingTrades = totalTrades - winningTrades;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const totalPnlSOL = allTradeResults.reduce((sum, t) => sum + t.finalPnlSOL, 0);
        const finalPortfolioValueSOL = INITIAL_SOL_BALANCE + totalPnlSOL;
        const totalReturn = (totalPnlSOL / INITIAL_SOL_BALANCE) * 100;

        // Update caller success rate
        await callerTracking.updateCallerSuccessRate(callerName, winRate);

        // Print results
        console.log('\n🎉 === CALLER SIMULATION COMPLETE ===');
        console.log(`👤 Caller: ${callerName}`);
        console.log(`💰 Initial Balance: ${INITIAL_SOL_BALANCE} SOL`);
        console.log(`💰 Final Balance: ${finalPortfolioValueSOL.toFixed(4)} SOL`);
        console.log(`📊 Total Return: ${totalReturn.toFixed(2)}%`);
        console.log(`🔄 Total Trades: ${totalTrades}`);
        console.log(`🎯 Win Rate: ${winRate.toFixed(2)}%`);
        console.log(`📊 Tokens with data: ${tokensWithPriceData}, Without data: ${tokensWithoutPriceData}`);

        // Save results
        const results = {
            callerName,
            simulationDate: new Date().toISOString(),
            initialBalanceSOL: INITIAL_SOL_BALANCE,
            finalBalanceSOL: finalPortfolioValueSOL,
            totalPnLSOL: totalPnlSOL,
            totalReturn: totalReturn,
            totalTrades: totalTrades,
            winRate: winRate,
            tokensWithData: tokensWithPriceData,
            tokensWithoutData: tokensWithoutPriceData,
            trades: allTradeResults
        };

        const outputPath = path.join(__dirname, `../caller_simulation_${callerName.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`📊 Results saved to: ${outputPath}`);

        return results;

    } catch (error) {
        console.error('❌ Caller simulation failed:', error);
    } finally {
        await callerTracking.close();
        await ohlcvIngestion.close();
    }
}

/**
 * Run simulations for multiple callers
 */
async function runMultiCallerSimulation(callerNames, maxTradesPerCaller = 15) {
    console.log(`🚀 Running simulations for ${callerNames.length} callers`);
    
    const results = [];
    
    for (const callerName of callerNames) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎯 Processing caller: ${callerName}`);
        console.log(`${'='.repeat(60)}`);
        
        const result = await runCallerSimulation(callerName, maxTradesPerCaller);
        if (result) {
            results.push(result);
        }
        
        // Small delay between callers
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    console.log('\n🎉 === MULTI-CALLER SIMULATION SUMMARY ===');
    results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.callerName}: ${result.totalReturn.toFixed(2)}% return, ${result.winRate.toFixed(1)}% win rate, ${result.totalTrades} trades`);
    });
    
    return results;
}

// Run simulation if this script is executed directly
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node scripts/simulate-caller.js <caller_name> [max_trades]');
        console.log('       node scripts/simulate-caller.js --multi <caller1,caller2,caller3> [max_trades_per_caller]');
        console.log('Example: node scripts/simulate-caller.js "Brook" 20');
        console.log('Example: node scripts/simulate-caller.js --multi "Brook,Brook Calls,BrookCalls" 15');
        process.exit(1);
    }
    
    if (args[0] === '--multi') {
        const callerNames = args[1].split(',').map(name => name.trim());
        const maxTrades = args[2] ? parseInt(args[2]) : 15;
        
        runMultiCallerSimulation(callerNames, maxTrades)
            .then(() => process.exit(0))
            .catch(console.error);
    } else {
        const callerName = args[0];
        const maxTrades = args[1] ? parseInt(args[1]) : 20;
        
        runCallerSimulation(callerName, maxTrades)
            .then(() => process.exit(0))
            .catch(console.error);
    }
}

module.exports = { runCallerSimulation, runMultiCallerSimulation };
