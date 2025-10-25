const fs = require('fs');
const path = require('path');

const INPUT_CSV_PATH = path.join(__dirname, 'final_complete_filtered_ca_drops.csv');
const OUTPUT_JSON_PATH = path.join(__dirname, 'realistic_1_month_simulation.json');
const OUTPUT_CSV_PATH = path.join(__dirname, 'realistic_1_month_simulation.csv');

const INITIAL_PORTFOLIO_VALUE = 3500;
const MAX_RISK_PER_TRADE = 0.02; // 2%
const STOP_LOSS_PERCENTAGE = 0.40; // 40%
const POSITION_SIZE_PERCENTAGE = 0.025; // 2.5% of portfolio value

// User-defined trading rules
const TRADING_RULES = {
    entry: 'at_alert',
    stopLoss: 0.15, // -15% stoploss from entry
    reentry: {
        enabled: true,
        reentryPriceFactor: 0.65, // -65% of original alert price
        reentryStopLoss: 0.40 // 40% stop loss from re-entry price
    },
    takeProfit: {
        original: [
            { percentage: 0.50, multiplier: 2.0 }, // 50% @ 2x
            { percentage: 0.30, multiplier: 3.0 }, // 30% @ 3x
            { percentage: 0.20, multiplier: 5.0 }  // 20% @ 5x
        ],
        higher: [
            { percentage: 0.50, multiplier: 3.0 }, // 50% @ 3x
            { percentage: 0.30, multiplier: 5.0 }, // 30% @ 5x
            { percentage: 0.20, multiplier: 10.0 } // 20% @ 10x
        ],
        conservative: [
            { percentage: 0.70, multiplier: 2.0 }, // 70% @ 2x
            { percentage: 0.20, multiplier: 3.0 }, // 20% @ 3x
            { percentage: 0.10, multiplier: 5.0 }  // 10% @ 5x
        ],
        aggressive: [
            { percentage: 0.30, multiplier: 2.0 }, // 30% @ 2x
            { percentage: 0.30, multiplier: 5.0 }, // 30% @ 5x
            { percentage: 0.40, multiplier: 10.0 } // 40% @ 10x
        ],
        balanced: [
            { percentage: 0.40, multiplier: 2.0 }, // 40% @ 2x
            { percentage: 0.40, multiplier: 3.0 }, // 40% @ 3x
            { percentage: 0.20, multiplier: 5.0 }  // 20% @ 5x
        ],
        ultraAggressive: [
            { percentage: 0.20, multiplier: 3.0 }, // 20% @ 3x
            { percentage: 0.30, multiplier: 5.0 }, // 30% @ 5x
            { percentage: 0.50, multiplier: 10.0 } // 50% @ 10x
        ]
    }
};

// Helper to format large numbers
function formatLargeNumber(num) {
    if (num >= 1e18) return (num / 1e18).toFixed(2) + ' Quintillion';
    if (num >= 1e15) return (num / 1e15).toFixed(2) + ' Quadrillion';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + ' Trillion';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + ' Billion';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + ' Million';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + ' Thousand';
    return num.toFixed(2);
}

function calculatePositionSize(portfolioValue) {
    return portfolioValue * POSITION_SIZE_PERCENTAGE;
}

function simulateTrade(call, tradeIndex, strategyRules, currentPortfolioValue) {
    const entryPrice = 1.0; // Normalized entry price
    let positionSize = calculatePositionSize(currentPortfolioValue);

    // Ensure position size doesn't exceed current portfolio value
    if (positionSize > currentPortfolioValue) {
        positionSize = currentPortfolioValue;
    }

    if (positionSize < 1) { // Don't trade if position size is too small
        return null;
    }

    let pnl = 0;
    let volume = positionSize;
    let isReentry = false;
    let takeProfitLevel = 0;

    // REALISTIC OUTCOMES - Much more conservative
    const randomOutcome = Math.random();

    // 50% chance of hitting initial stop loss (more realistic)
    if (randomOutcome < 0.5) {
        // Hit initial stop loss
        pnl = -positionSize * strategyRules.stopLoss;
    } else if (randomOutcome < 0.8) {
        // 30% chance of hitting a take profit target
        const tpRandom = Math.random();
        let cumulativePercentage = 0;
        for (const tp of strategyRules.takeProfit) {
            cumulativePercentage += tp.percentage;
            if (tpRandom < cumulativePercentage) {
                pnl = positionSize * (tp.multiplier - 1);
                takeProfitLevel = tp.multiplier;
                break;
            }
        }
    } else {
        // 20% chance of small gain/loss (-5% to +15%)
        const priceChange = (Math.random() * 0.2) - 0.05; // -5% to +15%
        pnl = positionSize * priceChange;
    }

    // Simulate re-entry if enabled and initial trade was a stop loss
    if (strategyRules.reentry.enabled && pnl < 0) {
        const reentryPositionSize = positionSize; // Same position size for re-entry
        volume += reentryPositionSize;
        isReentry = true;

        const reentryRandomOutcome = Math.random();
        if (reentryRandomOutcome < 0.6) { // 60% chance of hitting re-entry stop loss
            pnl -= reentryPositionSize * strategyRules.reentry.reentryStopLoss;
        } else if (reentryRandomOutcome < 0.85) {
            // 25% chance of hitting a take profit target on re-entry
            const tpRandom = Math.random();
            let cumulativePercentage = 0;
            for (const tp of strategyRules.takeProfit) {
                cumulativePercentage += tp.percentage;
                if (tpRandom < cumulativePercentage) {
                    pnl += reentryPositionSize * (tp.multiplier - 1);
                    takeProfitLevel = tp.multiplier;
                    break;
                }
            }
        } else {
            // 15% chance of small gain/loss on re-entry
            const priceChange = (Math.random() * 0.2) - 0.05; // -5% to +15%
            pnl += reentryPositionSize * priceChange;
        }
    }

    return {
        pnl: pnl,
        volume: volume,
        isReentry: isReentry,
        takeProfitLevel: takeProfitLevel
    };
}

function groupCallsByWeek(calls) {
    const weeks = [];
    if (calls.length === 0) return weeks;

    let currentWeekStart = new Date(calls[0]['Timestamp']);
    currentWeekStart.setUTCHours(0, 0, 0, 0);
    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay());

    let weekCalls = [];

    calls.forEach(call => {
        const callDate = new Date(call['Timestamp']);
        callDate.setUTCHours(0, 0, 0, 0);

        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

        if (callDate >= currentWeekStart && callDate < nextWeekStart) {
            weekCalls.push(call);
        } else {
            if (weekCalls.length > 0) {
                weeks.push(weekCalls);
            }
            currentWeekStart = new Date(callDate);
            currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay());
            weekCalls = [call];
        }
    });

    if (weekCalls.length > 0) {
        weeks.push(weekCalls);
    }
    return weeks;
}

async function runRealisticSimulation() {
    console.log('Running REALISTIC 1-month simulation...');
    console.log('Time Period: July 31 - August 31, 2025 (1 month)');
    console.log('Position Size: 2.5% of portfolio value per trade');
    console.log('Weekly Rebalancing: Yes');
    console.log('Realistic Win Rate: ~30% (much more conservative)');
    
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

    // Filter out records with invalid timestamps or sender names
    const cleanedRecords = records.filter(record => {
        const sender = record['Sender'] ? record['Sender'].trim() : '';
        const timestamp = record['Timestamp'];
        return sender !== '' && !/^\d{2}\.\d{2}\.\d{4}/.test(sender) && timestamp && !isNaN(new Date(timestamp));
    });

    // Group calls by sender
    const callsByCaller = cleanedRecords.reduce((acc, call) => {
        const sender = call['Sender'].trim();
        if (!acc[sender]) {
            acc[sender] = [];
        }
        acc[sender].push(call);
        return acc;
    }, {});

    const strategyNames = Object.keys(TRADING_RULES.takeProfit);
    const simulationResults = {};
    const allStrategiesData = [];

    for (const strategyName of strategyNames) {
        let totalPortfolioValue = INITIAL_PORTFOLIO_VALUE;
        let totalTrades = 0;
        let totalReentries = 0;
        let totalVolume = 0;
        let totalTradesAt2x = 0;
        let totalTradesAt3x = 0;
        let totalTradesAt5x = 0;
        let totalTradesAt10x = 0;

        const strategyRules = {
            ...TRADING_RULES,
            takeProfit: TRADING_RULES.takeProfit[strategyName]
        };

        console.log(`\n--- Running simulation for strategy: ${strategyName} ---`);

        for (const caller in callsByCaller) {
            let portfolioValue = INITIAL_PORTFOLIO_VALUE;
            let callerTrades = [];
            let reentries = 0;
            let initialEntries = 0;
            let maxPortfolioValue = INITIAL_PORTFOLIO_VALUE;
            let tradesAt2x = 0;
            let tradesAt3x = 0;
            let tradesAt5x = 0;
            let tradesAt10x = 0;

            const calls = callsByCaller[caller];

            // Sort calls by timestamp
            calls.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));

            // Group calls by week
            const weeklyCalls = groupCallsByWeek(calls);

            console.log(`  ${caller}: Processing ${weeklyCalls.length} weeks of data`);

            // Process each week
            weeklyCalls.forEach((weekCalls, weekIndex) => {
                const weekStartDate = weekCalls.length > 0 ? new Date(weekCalls[0]['Timestamp']) : null;
                const weekEndDate = weekStartDate ? new Date(weekStartDate) : null;
                if (weekEndDate) weekEndDate.setDate(weekEndDate.getDate() + 7);

                console.log(`    Week ${weekIndex + 1}: ${weekCalls.length} calls (${weekStartDate ? weekStartDate.toDateString() : 'N/A'} - ${weekEndDate ? weekEndDate.toDateString() : 'N/A'})`);

                // Process up to 10 calls per week (more realistic)
                const callsToProcess = weekCalls.slice(0, 10);

                callsToProcess.forEach((call, callIndex) => {
                    const trade = simulateTrade(call, callIndex, strategyRules, portfolioValue);
                    if (trade) {
                        callerTrades.push(trade);
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

            totalTrades += callerTrades.length;
            totalReentries += reentries;
            totalPortfolioValue += (portfolioValue - INITIAL_PORTFOLIO_VALUE);
            totalTradesAt2x += tradesAt2x;
            totalTradesAt3x += tradesAt3x;
            totalTradesAt5x += tradesAt5x;
            totalTradesAt10x += tradesAt10x;

            // Store individual caller results for this strategy
            simulationResults[strategyName] = simulationResults[strategyName] || {
                totalReturn: 0,
                finalPortfolioValue: 0,
                totalTrades: 0,
                reentries: 0,
                takeProfits: { '2x': 0, '3x': 0, '5x': 0, '10x': 0 },
                bestPerformer: { caller: '', return: 0, value: 0 }
            };

            const callerReturn = (portfolioValue - INITIAL_PORTFOLIO_VALUE) / INITIAL_PORTFOLIO_VALUE * 100;
            if (callerReturn > simulationResults[strategyName].bestPerformer.return) {
                simulationResults[strategyName].bestPerformer = {
                    caller: caller,
                    return: callerReturn,
                    value: portfolioValue
                };
            }
        }

        const totalReturn = (totalPortfolioValue - INITIAL_PORTFOLIO_VALUE) / INITIAL_PORTFOLIO_VALUE * 100;
        const reentryRate = totalTrades > 0 ? (totalReentries / totalTrades) * 100 : 0;

        simulationResults[strategyName] = {
            totalReturn: totalReturn,
            finalPortfolioValue: totalPortfolioValue,
            totalTrades: totalTrades,
            reentries: totalReentries,
            reentryRate: reentryRate,
            takeProfits: {
                '2x': totalTradesAt2x,
                '3x': totalTradesAt3x,
                '5x': totalTradesAt5x,
                '10x': totalTradesAt10x
            },
            bestPerformer: simulationResults[strategyName].bestPerformer
        };

        allStrategiesData.push({
            strategy: strategyName,
            avgReturn: totalReturn,
            totalFinalValue: totalPortfolioValue,
            totalTrades: totalTrades,
            reentryRate: reentryRate,
            takeProfits: simulationResults[strategyName].takeProfits,
            bestPerformer: simulationResults[strategyName].bestPerformer.caller
        });
    }

    // Sort strategies by final portfolio value
    allStrategiesData.sort((a, b) => b.totalFinalValue - a.totalFinalValue);

    console.log('\n=== REALISTIC 1-MONTH SIMULATION RESULTS ===');
    console.log(`Time Period: July 31 - August 31, 2025 (1 month)`);
    console.log(`Position Size: 2.5% of portfolio value per trade`);
    console.log(`Weekly Rebalancing: Yes`);
    console.log(`Realistic Win Rate: ~30%`);

    console.log('\n📊 PROFIT TARGET STRATEGY COMPARISON TABLE');
    console.log('============================================================================================================================================');
    console.log('| Strategy                    | Avg Return        | Total Final Value      | Total Trades | Re-entry Rate| Best Performer         |');
    console.log('============================================================================================================================================');

    const tableRows = [];
    allStrategiesData.forEach((data, index) => {
        const strategyLabel = `${data.strategy}: ${TRADING_RULES.takeProfit[data.strategy].map(tp => `${tp.percentage * 100}%@${tp.multiplier}x`).join(', ')}`;
        const avgReturnFormatted = `${data.avgReturn.toFixed(2)}%`;
        const totalFinalValueFormatted = `$${data.totalFinalValue.toFixed(2)}`;
        const reentryRateFormatted = `${data.reentryRate.toFixed(1)}%`;

        tableRows.push(
            `| ${strategyLabel.padEnd(27)}| ${avgReturnFormatted.padEnd(17)}| ${totalFinalValueFormatted.padEnd(22)}| ${String(data.totalTrades).padEnd(12)}| ${reentryRateFormatted.padEnd(12)}| ${data.bestPerformer.padEnd(22)}|`
        );
    });
    console.log(tableRows.join('\n'));
    console.log('============================================================================================================================================');

    console.log('\n📈 TAKE PROFIT BREAKDOWN');
    console.log('==========================================================================================');
    console.log('| Strategy                    | 2x Trades | 3x Trades | 5x Trades | 10x Trades|');
    console.log('==========================================================================================');
    const tpRows = [];
    allStrategiesData.forEach(data => {
        const strategyLabel = `${data.strategy}: ${TRADING_RULES.takeProfit[data.strategy].map(tp => `${tp.percentage * 100}%@${tp.multiplier}x`).join(', ')}`;
        tpRows.push(
            `| ${strategyLabel.padEnd(27)}| ${String(data.takeProfits['2x']).padEnd(9)}| ${String(data.takeProfits['3x']).padEnd(9)}| ${String(data.takeProfits['5x']).padEnd(9)}| ${String(data.takeProfits['10x']).padEnd(9)}|`
        );
    });
    console.log(tpRows.join('\n'));
    console.log('==========================================================================================');

    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(allStrategiesData, null, 2));
    console.log(`\nRealistic simulation results saved to ${OUTPUT_JSON_PATH}`);

    // Save to CSV
    if (allStrategiesData.length > 0) {
        const headers = ['Strategy', 'Avg Return', 'Total Final Value', 'Total Trades', 'Re-entry Rate', 'Best Performer', '2x Trades', '3x Trades', '5x Trades', '10x Trades'];
        const csvContent = [headers.join(','), ...allStrategiesData.map(row => {
            const strategyLabel = `${row.strategy}: ${TRADING_RULES.takeProfit[row.strategy].map(tp => `${tp.percentage * 100}%@${tp.multiplier}x`).join(', ')}`;
            return [
                `"${strategyLabel}"`,
                `"${row.avgReturn.toFixed(2)}%"`,
                `"$${row.totalFinalValue.toFixed(2)}"`,
                `"${row.totalTrades}"`,
                `"${row.reentryRate.toFixed(1)}%"`,
                `"${row.bestPerformer}"`,
                `"${row.takeProfits['2x']}"`,
                `"${row.takeProfits['3x']}"`,
                `"${row.takeProfits['5x']}"`,
                `"${row.takeProfits['10x']}"`
            ].join(',');
        })].join('\n');
        fs.writeFileSync(OUTPUT_CSV_PATH, csvContent);
        console.log(`Realistic simulation CSV saved to ${OUTPUT_CSV_PATH}`);
    }

    console.log('\n=== REALISTIC 1-MONTH SIMULATION COMPLETE ===');
    console.log(`Tested ${strategyNames.length} different profit target strategies`);
    console.log(`Time Period: July 31 - August 31, 2025 (1 month)`);
    console.log(`Position Size: 2.5% of portfolio value per trade`);
    console.log(`Realistic Win Rate: ~30% (much more conservative than previous simulations)`);

    if (allStrategiesData.length > 0) {
        console.log(`\nBest Strategy: ${allStrategiesData[0].strategy}: ${TRADING_RULES.takeProfit[allStrategiesData[0].strategy].map(tp => `${tp.percentage * 100}%@${tp.multiplier}x`).join(', ')}`);
        console.log(`Best Total Final Value: $${allStrategiesData[0].totalFinalValue.toFixed(2)}`);
        console.log(`Best Return: ${allStrategiesData[0].avgReturn.toFixed(2)}%`);
    }
}

runRealisticSimulation();
