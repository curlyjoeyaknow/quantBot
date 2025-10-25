/**
 * Batch Trading Simulation Script
 * ------------------------------
 * Continues processing CA drops in batches of 10 tokens at a time,
 * using real Birdeye API data for accurate trading simulation.
 * 
 * Features:
 * - Processes tokens in manageable batches
 * - Saves progress after each batch
 * - Continues from where previous runs left off
 * - Real-time API integration with rate limiting
 */

const fs = require('fs');
const path = require('path');

const INPUT_CSV_PATH = path.join(__dirname, 'data/exports/csv/final_complete_filtered_ca_drops.csv');
const OUTPUT_JSON_PATH = path.join(__dirname, 'batch_simulation_results.json');
const OUTPUT_CSV_PATH = path.join(__dirname, 'batch_simulation_results.csv');
const DETAILED_TRADES_PATH = path.join(__dirname, 'batch_detailed_trades.csv');
const PROGRESS_FILE = path.join(__dirname, 'simulation_progress.json');

// Configuration
const INITIAL_SOL_BALANCE = 100;
const FIXED_POSITION_SIZE_SOL = 2.5;
const SLIPPAGE_PERCENTAGE = 0.03;
const FEES_PERCENTAGE = 0.005;
const TOTAL_COST_PERCENTAGE = SLIPPAGE_PERCENTAGE + FEES_PERCENTAGE;

// Birdeye API configuration
const BIRDEYE_API_KEY = 'dec8084b90724ffe949b68d0a18359d6';

// Trading rules
const TRADING_RULES = {
    entry: 'at_alert',
    stopLoss: 0.15, // -15% stoploss from entry
    reentry: {
        enabled: true,
        reentryPriceFactor: 0.65, // -65% of original alert price
        reentryStopLoss: 0.40 // 40% stop loss from re-entry price
    },
    takeProfit: [
        { percentage: 0.50, multiplier: 2.0 }, // 50% @ 2x
        { percentage: 0.30, multiplier: 3.0 }, // 30% @ 3x
        { percentage: 0.20, multiplier: 5.0 }  // 20% @ 5x
    ]
};

// Helper function to parse timestamp
function parseTimestamp(timestampStr) {
    try {
        const cleanTimestamp = timestampStr.replace(/"/g, '');
        const parts = cleanTimestamp.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/);
        if (parts) {
            const [, day, month, year, hour, minute, second, tzSign, tzMinute] = parts;
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}:${tzMinute}`;
            return new Date(isoString);
        }
        return new Date(cleanTimestamp);
    } catch (e) {
        console.warn(`Could not parse timestamp: ${timestampStr}`);
        return null;
    }
}

// Function to convert date to Unix timestamp
function dateToUnixTimestamp(date) {
    return Math.floor(date.getTime() / 1000);
}

// Function to fetch price data from Birdeye API
async function fetchPriceData(tokenAddress, timestamp) {
    try {
        const unixTimestamp = dateToUnixTimestamp(timestamp);
        
        console.log(`🔍 Fetching price for ${tokenAddress} at ${timestamp.toISOString()} (${unixTimestamp})`);
        
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'x-chain': 'solana',
                'X-API-KEY': BIRDEYE_API_KEY
            }
        };
        
        const url = `https://public-api.birdeye.so/defi/history_price?address=${tokenAddress}&address_type=token&type=1m&time_from=${unixTimestamp}&time_to=${unixTimestamp + 3600}&ui_amount_mode=raw`;
        
        const response = await fetch(url, options);
        const data = await response.json();
        
        if (data && data.success && data.data && data.data.items && data.data.items.length > 0) {
            console.log(`✅ Found ${data.data.items.length} price points for ${tokenAddress}`);
            return data.data.items.map(item => ({
                timestamp: item.unixTime * 1000, // Convert to milliseconds
                price: parseFloat(item.value),
                volume: parseFloat(item.v || 0)
            }));
        } else {
            console.log(`❌ No price data found for ${tokenAddress}`);
            return null;
        }
    } catch (error) {
        console.warn(`⚠️ Error fetching price data for ${tokenAddress}:`, error.message);
        return null;
    }
}

// Function to simulate a single trade with real API data
async function simulateTradeWithRealAPI(call, strategyRules) {
    const tokenAddress = call['Address'];
    const alertTimestamp = parseTimestamp(call['Timestamp']);
    
    // Skip if no valid address or timestamp
    if (!tokenAddress || tokenAddress === 'N/A' || !alertTimestamp || isNaN(alertTimestamp.getTime())) {
        console.log(`Skipping invalid call: ${tokenAddress} - timestamp: ${call['Timestamp']}`);
        return null;
    }
    
    console.log(`\n🔄 Processing ${tokenAddress} at ${alertTimestamp.toISOString()}`);
    
    // Fetch real price data
    const priceData = await fetchPriceData(tokenAddress, alertTimestamp);
    if (!priceData || priceData.length === 0) {
        console.log(`❌ No price data available for ${tokenAddress}`);
        return null;
    }
    
    // Sort price data by timestamp
    priceData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Use first price point as entry price
    const entryPrice = priceData[0].price;
    const positionSizeSOL = FIXED_POSITION_SIZE_SOL;
    
    // Calculate costs
    const totalCostSOL = positionSizeSOL * TOTAL_COST_PERCENTAGE;
    const netPositionSizeSOL = positionSizeSOL - totalCostSOL;
    
    // Calculate stop loss and take profit levels
    const stopLossPrice = entryPrice * (1 - strategyRules.stopLoss);
    const reentryPrice = entryPrice * (1 - strategyRules.reentry.reentryPriceFactor);
    const reentryStopLossPrice = reentryPrice * (1 - strategyRules.reentry.reentryStopLoss);
    
    // Calculate take profit levels
    const takeProfitLevels = strategyRules.takeProfit.map(tp => ({
        percentage: tp.percentage,
        multiplier: tp.multiplier,
        price: entryPrice * tp.multiplier
    }));
    
    console.log(`📊 Entry: $${entryPrice.toFixed(8)}, SL: $${stopLossPrice.toFixed(8)}, Re-entry: $${reentryPrice.toFixed(8)}`);
    console.log(`🎯 Take Profits: ${takeProfitLevels.map(tp => `${tp.multiplier}x@$${tp.price.toFixed(8)}`).join(', ')}`);
    
    let tradeResult = {
        tokenAddress: tokenAddress,
        alertTimestamp: alertTimestamp.toISOString(),
        entryPrice: entryPrice,
        positionSizeSOL: positionSizeSOL,
        netPositionSizeSOL: netPositionSizeSOL,
        totalCostSOL: totalCostSOL,
        stopLossPrice: stopLossPrice,
        reentryPrice: reentryPrice,
        reentryStopLossPrice: reentryStopLossPrice,
        takeProfitLevels: takeProfitLevels,
        trades: [],
        finalPnLSOL: 0,
        totalVolumeSOL: 0,
        isReentry: false,
        exitReason: 'unknown',
        exitPrice: 0,
        exitTimestamp: null
    };
    
    // Simulate initial trade
    let currentPositionSOL = netPositionSizeSOL;
    let exitReason = 'unknown';
    let exitPrice = 0;
    let exitTimestamp = null;
    
    // Check each price point for stop loss or take profit hits
    for (let i = 0; i < priceData.length; i++) {
        const pricePoint = priceData[i];
        
        // Check if stop loss was hit
        if (pricePoint.price <= stopLossPrice) {
            exitPrice = stopLossPrice;
            exitTimestamp = pricePoint.timestamp;
            exitReason = 'stop_loss';
            
            // Calculate PnL for initial trade
            const pnlSOL = currentPositionSOL * ((exitPrice / entryPrice) - 1);
            tradeResult.finalPnLSOL += pnlSOL;
            tradeResult.totalVolumeSOL += positionSizeSOL;
            
            tradeResult.trades.push({
                type: 'initial',
                entryPrice: entryPrice,
                exitPrice: exitPrice,
                positionSizeSOL: currentPositionSOL,
                pnlSOL: pnlSOL,
                exitReason: exitReason,
                exitTimestamp: exitTimestamp,
                pricePointIndex: i,
                pricePointTime: new Date(pricePoint.timestamp).toISOString()
            });
            
            console.log(`🛑 STOP LOSS HIT at price point ${i}: $${exitPrice.toFixed(8)} (PnL: ${pnlSOL.toFixed(4)} SOL)`);
            
            // Check if re-entry should be attempted
            if (strategyRules.reentry.enabled) {
                console.log(`🔄 Attempting re-entry at $${reentryPrice.toFixed(8)}`);
                
                // Find when price reaches re-entry level
                for (let j = i; j < priceData.length; j++) {
                    const reentryPricePoint = priceData[j];
                    
                    if (reentryPricePoint.price <= reentryPrice) {
                        // Execute re-entry
                        const reentryPositionSOL = netPositionSizeSOL;
                        const reentryEntryPrice = reentryPrice;
                        tradeResult.isReentry = true;
                        
                        console.log(`✅ RE-ENTRY EXECUTED at price point ${j}: $${reentryEntryPrice.toFixed(8)}`);
                        
                        // Check re-entry price points for stop loss or take profit
                        for (let k = j; k < priceData.length; k++) {
                            const reentryCheckPricePoint = priceData[k];
                            
                            // Check re-entry stop loss
                            if (reentryCheckPricePoint.price <= reentryStopLossPrice) {
                                const reentryExitPrice = reentryStopLossPrice;
                                const reentryPnLSOL = reentryPositionSOL * ((reentryExitPrice / reentryEntryPrice) - 1);
                                
                                tradeResult.finalPnLSOL += reentryPnLSOL;
                                tradeResult.totalVolumeSOL += positionSizeSOL;
                                
                                tradeResult.trades.push({
                                    type: 'reentry',
                                    entryPrice: reentryEntryPrice,
                                    exitPrice: reentryExitPrice,
                                    positionSizeSOL: reentryPositionSOL,
                                    pnlSOL: reentryPnLSOL,
                                    exitReason: 'reentry_stop_loss',
                                    exitTimestamp: reentryCheckPricePoint.timestamp,
                                    pricePointIndex: k,
                                    pricePointTime: new Date(reentryCheckPricePoint.timestamp).toISOString()
                                });
                                
                                tradeResult.exitReason = 'reentry_stop_loss';
                                tradeResult.exitPrice = reentryExitPrice;
                                tradeResult.exitTimestamp = reentryCheckPricePoint.timestamp;
                                
                                console.log(`🛑 RE-ENTRY STOP LOSS HIT at price point ${k}: $${reentryExitPrice.toFixed(8)} (PnL: ${reentryPnLSOL.toFixed(4)} SOL)`);
                                
                                return tradeResult;
                            }
                            
                            // Check re-entry take profits
                            for (const tp of takeProfitLevels) {
                                if (reentryCheckPricePoint.price >= tp.price) {
                                    const reentryExitPrice = tp.price;
                                    const reentryPnLSOL = reentryPositionSOL * ((reentryExitPrice / reentryEntryPrice) - 1);
                                    
                                    tradeResult.finalPnLSOL += reentryPnLSOL;
                                    tradeResult.totalVolumeSOL += positionSizeSOL;
                                    
                                    tradeResult.trades.push({
                                        type: 'reentry',
                                        entryPrice: reentryEntryPrice,
                                        exitPrice: reentryExitPrice,
                                        positionSizeSOL: reentryPositionSOL,
                                        pnlSOL: reentryPnLSOL,
                                        exitReason: `take_profit_${tp.multiplier}x`,
                                        exitTimestamp: reentryCheckPricePoint.timestamp,
                                        pricePointIndex: k,
                                        pricePointTime: new Date(reentryCheckPricePoint.timestamp).toISOString()
                                    });
                                    
                                    tradeResult.exitReason = `take_profit_${tp.multiplier}x`;
                                    tradeResult.exitPrice = reentryExitPrice;
                                    tradeResult.exitTimestamp = reentryCheckPricePoint.timestamp;
                                    
                                    console.log(`🎯 RE-ENTRY TAKE PROFIT ${tp.multiplier}x HIT at price point ${k}: $${reentryExitPrice.toFixed(8)} (PnL: ${reentryPnLSOL.toFixed(4)} SOL)`);
                                    
                                    return tradeResult;
                                }
                            }
                        }
                        
                        // If no exit found, exit at last price point
                        const lastPricePoint = priceData[priceData.length - 1];
                        const reentryExitPrice = lastPricePoint.price;
                        const reentryPnLSOL = reentryPositionSOL * ((reentryExitPrice / reentryEntryPrice) - 1);
                        
                        tradeResult.finalPnLSOL += reentryPnLSOL;
                        tradeResult.totalVolumeSOL += positionSizeSOL;
                        
                        tradeResult.trades.push({
                            type: 'reentry',
                            entryPrice: reentryEntryPrice,
                            exitPrice: reentryExitPrice,
                            positionSizeSOL: reentryPositionSOL,
                            pnlSOL: reentryPnLSOL,
                            exitReason: 'timeout',
                            exitTimestamp: lastPricePoint.timestamp,
                            pricePointIndex: priceData.length - 1,
                            pricePointTime: new Date(lastPricePoint.timestamp).toISOString()
                        });
                        
                        tradeResult.exitReason = 'timeout';
                        tradeResult.exitPrice = reentryExitPrice;
                        tradeResult.exitTimestamp = lastPricePoint.timestamp;
                        
                        console.log(`⏰ RE-ENTRY TIMEOUT at last price point: $${reentryExitPrice.toFixed(8)} (PnL: ${reentryPnLSOL.toFixed(4)} SOL)`);
                        
                        return tradeResult;
                    }
                }
            }
            
            tradeResult.exitReason = exitReason;
            tradeResult.exitPrice = exitPrice;
            tradeResult.exitTimestamp = exitTimestamp;
            
            return tradeResult;
        }
        
        // Check take profit levels
        for (const tp of takeProfitLevels) {
            if (pricePoint.price >= tp.price) {
                exitPrice = tp.price;
                exitTimestamp = pricePoint.timestamp;
                exitReason = `take_profit_${tp.multiplier}x`;
                
                // Calculate PnL
                const pnlSOL = currentPositionSOL * ((exitPrice / entryPrice) - 1);
                tradeResult.finalPnLSOL += pnlSOL;
                tradeResult.totalVolumeSOL += positionSizeSOL;
                
                tradeResult.trades.push({
                    type: 'initial',
                    entryPrice: entryPrice,
                    exitPrice: exitPrice,
                    positionSizeSOL: currentPositionSOL,
                    pnlSOL: pnlSOL,
                    exitReason: exitReason,
                    exitTimestamp: exitTimestamp,
                    pricePointIndex: i,
                    pricePointTime: new Date(pricePoint.timestamp).toISOString()
                });
                
                tradeResult.exitReason = exitReason;
                tradeResult.exitPrice = exitPrice;
                tradeResult.exitTimestamp = exitTimestamp;
                
                console.log(`🎯 TAKE PROFIT ${tp.multiplier}x HIT at price point ${i}: $${exitPrice.toFixed(8)} (PnL: ${pnlSOL.toFixed(4)} SOL)`);
                
                return tradeResult;
            }
        }
    }
    
    // If no exit condition met, exit at last price point
    const lastPricePoint = priceData[priceData.length - 1];
    exitPrice = lastPricePoint.price;
    exitTimestamp = lastPricePoint.timestamp;
    exitReason = 'timeout';
    
    const pnlSOL = currentPositionSOL * ((exitPrice / entryPrice) - 1);
    tradeResult.finalPnLSOL += pnlSOL;
    tradeResult.totalVolumeSOL += positionSizeSOL;
    
    tradeResult.trades.push({
        type: 'initial',
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        positionSizeSOL: currentPositionSOL,
        pnlSOL: pnlSOL,
        exitReason: exitReason,
        exitTimestamp: exitTimestamp,
        pricePointIndex: priceData.length - 1,
        pricePointTime: new Date(lastPricePoint.timestamp).toISOString()
    });
    
    tradeResult.exitReason = exitReason;
    tradeResult.exitPrice = exitPrice;
    tradeResult.exitTimestamp = exitTimestamp;
    
    console.log(`⏰ TIMEOUT at last price point: $${exitPrice.toFixed(8)} (PnL: ${pnlSOL.toFixed(4)} SOL)`);
    
    return tradeResult;
}

// Function to load progress
function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
        console.log(`📂 Loaded progress: ${progress.processedTokens} tokens processed, starting from index ${progress.lastProcessedIndex}`);
        return progress;
    }
    return {
        processedTokens: 0,
        lastProcessedIndex: 0,
        totalPnLSOL: 0,
        totalVolumeSOL: 0,
        totalTrades: 0,
        totalReentries: 0,
        successfulTrades: 0,
        stopLossTrades: 0,
        timeoutTrades: 0,
        takeProfitCounts: { '2x': 0, '3x': 0, '5x': 0 },
        tokensWithData: 0,
        tokensWithoutData: 0,
        individualTrades: [],
        detailedTradeLogs: []
    };
}

// Function to save progress
function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Function to save final results
function saveResults(progress) {
    const finalBalanceSOL = INITIAL_SOL_BALANCE + progress.totalPnLSOL;
    const totalReturn = (progress.totalPnLSOL / INITIAL_SOL_BALANCE) * 100;
    const reentryRate = progress.totalTrades > 0 ? (progress.totalReentries / progress.totalTrades) * 100 : 0;
    const winRate = progress.totalTrades > 0 ? (progress.successfulTrades / progress.totalTrades) * 100 : 0;
    
    const simulationResult = {
        strategyName: 'batch_api',
        initialBalanceSOL: INITIAL_SOL_BALANCE,
        finalBalanceSOL: finalBalanceSOL,
        totalPnLSOL: progress.totalPnLSOL,
        totalReturn: totalReturn,
        totalTrades: progress.totalTrades,
        totalVolumeSOL: progress.totalVolumeSOL,
        reentryRate: reentryRate,
        winRate: winRate,
        successfulTrades: progress.successfulTrades,
        stopLossTrades: progress.stopLossTrades,
        timeoutTrades: progress.timeoutTrades,
        takeProfitCounts: progress.takeProfitCounts,
        tokensWithData: progress.tokensWithData,
        tokensWithoutData: progress.tokensWithoutData,
        individualTrades: progress.individualTrades,
        tradingRules: TRADING_RULES,
        processedTokens: progress.processedTokens,
        lastProcessedIndex: progress.lastProcessedIndex
    };
    
    // Save results
    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(simulationResult, null, 2));
    
    // Create CSV summary
    const csvHeaders = [
        'Strategy',
        'Initial Balance (SOL)',
        'Final Balance (SOL)',
        'Total PnL (SOL)',
        'Total Return (%)',
        'Total Trades',
        'Total Volume (SOL)',
        'Re-entry Rate (%)',
        'Win Rate (%)',
        'Successful Trades',
        'Stop Loss Trades',
        'Timeout Trades',
        '2x Trades',
        '3x Trades',
        '5x Trades',
        'Tokens With Data',
        'Tokens Without Data',
        'Processed Tokens',
        'Last Processed Index'
    ];
    
    const csvRow = [
        simulationResult.strategyName,
        simulationResult.initialBalanceSOL,
        simulationResult.finalBalanceSOL.toFixed(4),
        simulationResult.totalPnLSOL.toFixed(4),
        simulationResult.totalReturn.toFixed(2),
        simulationResult.totalTrades,
        simulationResult.totalVolumeSOL.toFixed(4),
        simulationResult.reentryRate.toFixed(2),
        simulationResult.winRate.toFixed(2),
        simulationResult.successfulTrades,
        simulationResult.stopLossTrades,
        simulationResult.timeoutTrades,
        simulationResult.takeProfitCounts['2x'],
        simulationResult.takeProfitCounts['3x'],
        simulationResult.takeProfitCounts['5x'],
        simulationResult.tokensWithData,
        simulationResult.tokensWithoutData,
        simulationResult.processedTokens,
        simulationResult.lastProcessedIndex
    ];
    
    const csvOutput = [csvHeaders.join(','), csvRow.map(cell => `"${cell}"`).join(',')].join('\n');
    
    fs.writeFileSync(OUTPUT_CSV_PATH, csvOutput);
    
    // Save detailed trades
    if (progress.detailedTradeLogs.length > 0) {
        const detailedHeaders = Object.keys(progress.detailedTradeLogs[0]);
        const detailedCsvContent = [
            detailedHeaders.join(','),
            ...progress.detailedTradeLogs.map(row => detailedHeaders.map(header => `"${String(row[header]).replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        fs.writeFileSync(DETAILED_TRADES_PATH, detailedCsvContent);
    }
    
    return simulationResult;
}

async function runBatchSimulation() {
    console.log('🚀 Running BATCH API simulation...');
    console.log('📊 Processing tokens in batches of 10');
    console.log('📊 Using Birdeye API for real-time price data');
    console.log(`💰 Fixed position size: ${FIXED_POSITION_SIZE_SOL} SOL per trade`);
    console.log(`💸 Slippage: ${SLIPPAGE_PERCENTAGE*100}%, Fees: ${FEES_PERCENTAGE*100}% (Total: ${(TOTAL_COST_PERCENTAGE*100).toFixed(1)}%)`);
    console.log(`🏦 Initial SOL balance: ${INITIAL_SOL_BALANCE} SOL`);
    
    // Load CA drops data
    const csvContent = fs.readFileSync(INPUT_CSV_PATH, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
        console.log('No data found in CSV file');
        return;
    }
    
    const headers = lines[0].split(',');
    const records = lines.slice(1).map(line => {
        const values = line.split(',');
        let obj = {};
        headers.forEach((header, i) => {
            obj[header.trim()] = values[i] ? values[i].trim().replace(/"/g, '') : '';
        });
        return obj;
    });
    
    // Filter valid records
    const validRecords = records.filter(record => {
        const sender = record['Sender'] ? record['Sender'].trim() : '';
        const timestamp = record['Timestamp'];
        const address = record['Address'];
        return sender !== '' && 
               !/^\d{2}\.\d{2}\.\d{4}/.test(sender) && 
               timestamp && 
               address && 
               address !== 'N/A' &&
               !isNaN(new Date(timestamp));
    });
    
    console.log(`📋 Found ${validRecords.length} valid CA drops to simulate`);
    
    // Load progress
    const progress = loadProgress();
    
    const BATCH_SIZE = 10;
    const startIndex = progress.lastProcessedIndex;
    const endIndex = Math.min(startIndex + BATCH_SIZE, validRecords.length);
    
    console.log(`\n📈 Processing batch: tokens ${startIndex + 1} to ${endIndex} (${endIndex - startIndex} tokens)`);
    
    // Process current batch
    for (let i = startIndex; i < endIndex; i++) {
        const call = validRecords[i];
        console.log(`\n📈 Processing trade ${i + 1}/${validRecords.length}: ${call['Address']}`);
        
        const tradeResult = await simulateTradeWithRealAPI(call, TRADING_RULES);
        
        if (tradeResult) {
            progress.tokensWithData++;
            progress.totalPnLSOL += tradeResult.finalPnLSOL;
            progress.totalVolumeSOL += tradeResult.totalVolumeSOL;
            progress.totalTrades += tradeResult.trades.length;
            
            if (tradeResult.isReentry) {
                progress.totalReentries++;
            }
            
            // Count exit reasons
            if (tradeResult.exitReason.includes('take_profit')) {
                progress.successfulTrades++;
                const multiplier = tradeResult.exitReason.match(/(\d+)x/);
                if (multiplier) {
                    const mult = multiplier[1];
                    if (progress.takeProfitCounts[mult + 'x']) {
                        progress.takeProfitCounts[mult + 'x']++;
                    }
                }
            } else if (tradeResult.exitReason.includes('stop_loss')) {
                progress.stopLossTrades++;
            } else if (tradeResult.exitReason === 'timeout') {
                progress.timeoutTrades++;
            }
            
            progress.individualTrades.push(tradeResult);
            
            // Add detailed trade logs
            tradeResult.trades.forEach(trade => {
                progress.detailedTradeLogs.push({
                    tokenAddress: tradeResult.tokenAddress,
                    alertTimestamp: tradeResult.alertTimestamp,
                    tradeType: trade.type,
                    entryPrice: trade.entryPrice,
                    exitPrice: trade.exitPrice,
                    positionSizeSOL: trade.positionSizeSOL,
                    pnlSOL: trade.pnlSOL,
                    exitReason: trade.exitReason,
                    exitTimestamp: trade.exitTimestamp,
                    pricePointTime: trade.pricePointTime,
                    pricePointIndex: trade.pricePointIndex
                });
            });
        } else {
            progress.tokensWithoutData++;
        }
        
        progress.processedTokens++;
        progress.lastProcessedIndex = i + 1;
        
        // Save progress after each token
        saveProgress(progress);
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // Save final results
    const simulationResult = saveResults(progress);
    
    console.log('\n🎉 === BATCH SIMULATION COMPLETE ===');
    console.log(`📊 Results saved to: ${OUTPUT_JSON_PATH}`);
    console.log(`📋 CSV summary saved to: ${OUTPUT_CSV_PATH}`);
    console.log(`📋 Detailed trades saved to: ${DETAILED_TRADES_PATH}`);
    console.log(`📂 Progress saved to: ${PROGRESS_FILE}`);
    console.log(`\n📈 BATCH RESULTS:`);
    console.log(`💰 Final Balance: ${simulationResult.finalBalanceSOL.toFixed(4)} SOL`);
    console.log(`📊 Total Return: ${simulationResult.totalReturn.toFixed(2)}%`);
    console.log(`🔄 Total Trades: ${simulationResult.totalTrades}`);
    console.log(`🎯 Win Rate: ${simulationResult.winRate.toFixed(2)}%`);
    console.log(`🔄 Re-entry Rate: ${simulationResult.reentryRate.toFixed(2)}%`);
    console.log(`🛑 Stop Losses: ${simulationResult.stopLossTrades}, 🎯 Take Profits: ${simulationResult.successfulTrades}, ⏰ Timeouts: ${simulationResult.timeoutTrades}`);
    console.log(`📊 Tokens with price data: ${simulationResult.tokensWithData}, Without data: ${simulationResult.tokensWithoutData}`);
    console.log(`📈 Processed: ${simulationResult.processedTokens} tokens (${simulationResult.lastProcessedIndex}/${validRecords.length})`);
    
    if (simulationResult.lastProcessedIndex < validRecords.length) {
        console.log(`\n🔄 Ready for next batch! Run again to continue from token ${simulationResult.lastProcessedIndex + 1}`);
    } else {
        console.log(`\n✅ All tokens processed! Complete simulation finished.`);
    }
}

// Run the simulation
runBatchSimulation().catch(console.error);
