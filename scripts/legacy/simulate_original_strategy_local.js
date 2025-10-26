const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

// Configuration
const INPUT_CSV_PATH = path.join(__dirname, 'data/exports/csv/brook_last_week_calls.csv');
const OHLCV_DIR = path.join(__dirname, 'data/raw/brook_ohlcv');
const OUTPUT_JSON_PATH = path.join(__dirname, 'original_strategy_local_results.json');
const OUTPUT_CSV_PATH = path.join(__dirname, 'original_strategy_local_results.csv');
const DETAILED_TRADES_PATH = path.join(__dirname, 'original_strategy_local_detailed_trades.csv');

// Configuration
const INITIAL_SOL_BALANCE = 100;
const FIXED_POSITION_SIZE_SOL = 2.5; // Fixed SOL amount per trade
const SLIPPAGE_PERCENTAGE = 0.03; // 3% slippage
const FEES_PERCENTAGE = 0.005; // 0.5% fees
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

// Function to parse timestamp string into a Date object
function parseTimestamp(timestampStr) {
    try {
        const cleanTimestamp = timestampStr.replace(/"/g, '');
        const parts = cleanTimestamp.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/);
        if (parts) {
            const [, day, month, year, hour, minute, second, tzSign, tzMinute] = parts;
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}:${tzMinute}`;
            return new Date(isoString);
        }
        return new Date('Invalid Date');
    } catch (e) {
        console.warn(`Could not parse timestamp: ${timestampStr}`);
        return new Date('Invalid Date');
    }
}

// Function to load OHLCV data from local CSV files
function loadOHLCVData(tokenAddress) {
    try {
        // Look for matching CSV file by checking if the token address contains the shortened address from filename
        const files = fs.readdirSync(OHLCV_DIR);
        let matchingFile = null;
        
        // First try exact match
        matchingFile = files.find(file => file.includes(tokenAddress));
        
        // If no exact match, try partial match (shortened address)
        if (!matchingFile) {
            // Extract shortened address from filename and check if tokenAddress contains it
            for (const file of files) {
                const parts = file.split('_');
                if (parts.length >= 2) {
                    const shortenedAddress = parts[1].replace('.csv', '');
                    if (tokenAddress.toLowerCase().includes(shortenedAddress.toLowerCase())) {
                        matchingFile = file;
                        break;
                    }
                }
            }
        }
        
        if (!matchingFile) {
            console.log(`No matching OHLCV file found for ${tokenAddress}`);
            return null;
        }
        
        console.log(`Found OHLCV file: ${matchingFile} for token ${tokenAddress}`);
        const filePath = path.join(OHLCV_DIR, matchingFile);
        const csvContent = fs.readFileSync(filePath, 'utf8');
        
        return new Promise((resolve, reject) => {
            parse(csvContent, {
                columns: true,
                skip_empty_lines: true
            }, (err, records) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const ohlcvData = records.map(record => ({
                    timestamp: parseInt(record.Timestamp),
                    dateTime: new Date(parseInt(record.Timestamp)),
                    open: parseFloat(record.Open),
                    high: parseFloat(record.High),
                    low: parseFloat(record.Low),
                    close: parseFloat(record.Close),
                    volume: parseFloat(record.Volume) || 0
                }));
                
                resolve(ohlcvData);
            });
        });
    } catch (error) {
        console.error(`Error loading OHLCV data for ${tokenAddress}:`, error.message);
        return null;
    }
}

// Function to calculate entry rating based on price action in first hour
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

// Main simulation function for a single trade
async function simulateTrade(call, currentSOLBalance) {
    const tokenAddress = call['Address'];
    const alertTimestamp = parseTimestamp(call['Timestamp']);

    if (!tokenAddress || tokenAddress === 'N/A' || !alertTimestamp || isNaN(alertTimestamp.getTime())) {
        console.log(`Skipping invalid call: ${tokenAddress} with timestamp ${call['Timestamp']}`);
        return null;
    }

    console.log(`\n🔄 Processing ${tokenAddress} at ${alertTimestamp.toISOString()}`);

    const ohlcvData = await loadOHLCVData(tokenAddress);

    if (!ohlcvData || ohlcvData.length === 0) {
        console.log(`❌ No local OHLCV data found for ${tokenAddress}`);
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

async function runOriginalStrategySimulation() {
    console.log('🚀 Running ORIGINAL STRATEGY simulation using LOCAL OHLCV data...');
    console.log(`💰 Fixed position size: ${FIXED_POSITION_SIZE_SOL} SOL per trade`);
    console.log(`💸 Slippage: ${SLIPPAGE_PERCENTAGE * 100}%, Fees: ${FEES_PERCENTAGE * 100}% (Total: ${TOTAL_COST_PERCENTAGE * 100}%)`);
    console.log(`🏦 Initial SOL balance: ${INITIAL_SOL_BALANCE} SOL`);
    console.log(`📈 Trading Rules:`);
    console.log(`   - Entry: At alert price`);
    console.log(`   - Stop Loss: -${TRADING_RULES.stopLoss * 100}%`);
    console.log(`   - Re-entry: ${TRADING_RULES.reentry.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   - Take Profits: ${TRADING_RULES.takeProfit.map(tp => `${tp.percentage * 100}% @ ${tp.multiplier}x`).join(', ')}`);

    const csvContent = fs.readFileSync(INPUT_CSV_PATH, 'utf8');
    const records = await new Promise((resolve, reject) => {
        parse(csvContent, {
            columns: true,
            skip_empty_lines: true
        }, (err, records) => {
            if (err) reject(err);
            resolve(records);
        });
    });

    // Filter for favorite callers
    const favoriteCallers = [
        'Brook',
        'Brook Giga I verify @BrookCalls',
        'Brook Calls',
        'BrookCalls'
    ];
    
    const cleanedRecords = records.filter(record => {
        const sender = record['Sender'] ? record['Sender'].trim() : '';
        const timestamp = record['Timestamp'];
        const address = record['Address'];
        
        // Check if it's from favorite callers
        const isFavoriteCaller = favoriteCallers.some(caller => 
            sender.toLowerCase().includes(caller.toLowerCase())
        );
        
        return sender !== '' && 
               !/^\d{2}\.\d{2}\.\d{4}/.test(sender) && 
               timestamp && 
               !isNaN(parseTimestamp(timestamp).getTime()) && 
               address && 
               address !== 'N/A' &&
               isFavoriteCaller;
    });

    console.log(`📋 Found ${cleanedRecords.length} valid CA drops from favorite callers`);
    
    // Limit to first 15 trades for reasonable processing time
    const limitedRecords = cleanedRecords.slice(0, 15);
    console.log(`📊 Processing first ${limitedRecords.length} trades for performance`);

    let currentSOLBalance = INITIAL_SOL_BALANCE;
    let allTradeResults = [];
    let detailedTradeLogs = [];
    let tokensWithPriceData = 0;
    let tokensWithoutPriceData = 0;

    // Process limited tokens
    for (let i = 0; i < limitedRecords.length; i++) {
        const call = limitedRecords[i];
        const tokenAddress = call['Address'];

        console.log(`\n📈 Processing trade ${i + 1}/${limitedRecords.length}: ${tokenAddress}`);
        const tradeResult = await simulateTrade(call, currentSOLBalance);

        if (tradeResult) {
            allTradeResults.push(tradeResult);
            currentSOLBalance += tradeResult.finalPnlSOL;
            detailedTradeLogs.push(...tradeResult.trades.map(t => ({
                tokenAddress: tradeResult.tokenAddress,
                alertTimestamp: tradeResult.alertTimestamp,
                tradeType: t.type,
                price: t.price,
                timestamp: t.timestamp,
                amountSOL: t.amountSOL,
                pnlSOL: t.pnlSOL,
                reason: t.reason,
                currentPortfolioSOL: currentSOLBalance,
                entryRating: tradeResult.entryRating.rating,
                entryVolatility: tradeResult.entryRating.volatility,
                entryTrend: tradeResult.entryRating.priceTrend
            })));
            tokensWithPriceData++;
        } else {
            tokensWithoutPriceData++;
        }
    }

    // Generate Summary Results
    const totalTrades = allTradeResults.length;
    const winningTrades = allTradeResults.filter(t => t.finalPnlSOL > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalPnlSOL = allTradeResults.reduce((sum, t) => sum + t.finalPnlSOL, 0);
    const finalPortfolioValueSOL = INITIAL_SOL_BALANCE + totalPnlSOL;
    const totalReturn = (totalPnlSOL / INITIAL_SOL_BALANCE) * 100;
    const totalStopLosses = allTradeResults.filter(t => t.exitReason === 'stop_loss').length;
    const totalTakeProfits = allTradeResults.filter(t => t.exitReason && t.exitReason.includes('tp')).length;
    const totalDataEnds = allTradeResults.filter(t => t.exitReason === 'data_end').length;

    // Entry rating analysis
    const entryRatings = allTradeResults.reduce((acc, trade) => {
        const rating = trade.entryRating.rating;
        acc[rating] = (acc[rating] || 0) + 1;
        return acc;
    }, {});

    const summary = {
        strategyName: 'original_strategy_local',
        initialBalanceSOL: INITIAL_SOL_BALANCE,
        finalBalanceSOL: finalPortfolioValueSOL,
        totalPnLSOL: totalPnlSOL,
        totalReturn: totalReturn,
        totalTrades: totalTrades,
        totalVolumeSOL: totalTrades * FIXED_POSITION_SIZE_SOL,
        winRate: winRate,
        successfulTrades: winningTrades,
        stopLossTrades: totalStopLosses,
        dataEndTrades: totalDataEnds,
        takeProfitCounts: {
            '2x': allTradeResults.filter(t => t.trades.some(tr => tr.reason.includes('2x'))).length,
            '3x': allTradeResults.filter(t => t.trades.some(tr => tr.reason.includes('3x'))).length,
            '5x': allTradeResults.filter(t => t.trades.some(tr => tr.reason.includes('5x'))).length
        },
        tokensWithData: tokensWithPriceData,
        tokensWithoutData: tokensWithoutPriceData,
        entryRatings: entryRatings,
        individualTrades: allTradeResults,
        tradingRules: TRADING_RULES
    };

    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(summary, null, 2));
    console.log(`📊 Results saved to: ${OUTPUT_JSON_PATH}`);

    // Save CSV summary
    const summaryHeaders = [
        'Strategy', 'Initial Balance (SOL)', 'Final Balance (SOL)', 'Total PnL (SOL)', 'Total Return (%)',
        'Total Trades', 'Total Volume (SOL)', 'Win Rate (%)', 'Successful Trades', 'Stop Loss Trades',
        'Data End Trades', '2x Trades', '3x Trades', '5x Trades', 'Tokens With Data', 'Tokens Without Data',
        'Entry Rating A', 'Entry Rating B', 'Entry Rating C', 'Entry Rating D'
    ];
    const summaryRows = [
        [
            'original_strategy_local',
            INITIAL_SOL_BALANCE,
            finalPortfolioValueSOL.toFixed(4),
            totalPnlSOL.toFixed(4),
            totalReturn.toFixed(2),
            totalTrades,
            (totalTrades * FIXED_POSITION_SIZE_SOL).toFixed(4),
            winRate.toFixed(2),
            winningTrades,
            totalStopLosses,
            totalDataEnds,
            summary.takeProfitCounts['2x'],
            summary.takeProfitCounts['3x'],
            summary.takeProfitCounts['5x'],
            tokensWithPriceData,
            tokensWithoutPriceData,
            entryRatings.A || 0,
            entryRatings.B || 0,
            entryRatings.C || 0,
            entryRatings.D || 0
        ]
    ];
    const summaryCsvContent = [
        summaryHeaders.join(','),
        ...summaryRows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    fs.writeFileSync(OUTPUT_CSV_PATH, summaryCsvContent);
    console.log(`📋 CSV summary saved to: ${OUTPUT_CSV_PATH}`);

    // Save detailed trades
    if (detailedTradeLogs.length > 0) {
        const detailedHeaders = Object.keys(detailedTradeLogs[0]);
        const detailedCsvContent = [
            detailedHeaders.join(','),
            ...detailedTradeLogs.map(row => detailedHeaders.map(header => `"${String(row[header]).replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        fs.writeFileSync(DETAILED_TRADES_PATH, detailedCsvContent);
        console.log(`📋 Detailed trades saved to: ${DETAILED_TRADES_PATH}`);
    }

    console.log('\n🎉 === ORIGINAL STRATEGY SIMULATION COMPLETE ===');
    console.log(`📈 RESULTS:`);
    console.log(`💰 Initial Balance: ${INITIAL_SOL_BALANCE} SOL`);
    console.log(`💰 Final Balance: ${finalPortfolioValueSOL.toFixed(4)} SOL`);
    console.log(`📊 Total Return: ${totalReturn.toFixed(2)}%`);
    console.log(`🔄 Total Trades: ${totalTrades}`);
    console.log(`🎯 Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`🛑 Stop Losses: ${totalStopLosses}, 🎯 Take Profits: ${totalTakeProfits}, 📊 Data Ends: ${totalDataEnds}`);
    console.log(`📊 Tokens with price data: ${tokensWithPriceData}, Without data: ${tokensWithoutPriceData}`);
    console.log(`📈 Entry Ratings: A: ${entryRatings.A || 0}, B: ${entryRatings.B || 0}, C: ${entryRatings.C || 0}, D: ${entryRatings.D || 0}`);
    console.log(`🎯 Take Profit Breakdown: 2x: ${summary.takeProfitCounts['2x']}, 3x: ${summary.takeProfitCounts['3x']}, 5x: ${summary.takeProfitCounts['5x']}`);
    
    // Show per-trade rundowns
    console.log('\n📋 === PER-TRADE RUNDOWNS ===');
    allTradeResults.forEach((trade, index) => {
        console.log(`\n${index + 1}. ${trade.tokenAddress}`);
        console.log(`   📅 Alert: ${trade.alertTimestamp}`);
        console.log(`   💰 Entry: $${trade.entryPrice.toFixed(8)}`);
        console.log(`   🛑 Stop Loss: $${trade.stopLossPrice.toFixed(8)} (-30%)`);
        console.log(`   🎯 Take Profits: 2x@$${trade.takeProfitLevels[0].price.toFixed(8)}, 3x@$${trade.takeProfitLevels[1].price.toFixed(8)}, 5x@$${trade.takeProfitLevels[2].price.toFixed(8)}`);
        console.log(`   📈 Entry Rating: ${trade.entryRating.rating} (Vol: ${trade.entryRating.volatility}%, Trend: ${trade.entryRating.priceTrend}%)`);
        console.log(`   💸 Exit: $${trade.exitPrice?.toFixed(8) || 'N/A'} (${trade.exitReason})`);
        console.log(`   💰 P&L: ${trade.finalPnlSOL.toFixed(4)} SOL`);
        console.log(`   📊 Trades: ${trade.trades.length} execution(s)`);
        trade.trades.forEach(t => {
            console.log(`      - ${t.type}: ${t.amountSOL.toFixed(4)} SOL @ $${t.price.toFixed(8)} (${t.pnlSOL.toFixed(4)} SOL)`);
        });
    });
}

runOriginalStrategySimulation();
