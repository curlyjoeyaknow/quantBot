const fs = require('fs');
const csv = require('csv-parser');

// Main async function to analyze filtered CA (Contract Address) drops from a CSV report
async function analyzeFilteredCaDrops() {
    const results = []; // Accumulator for CSV row objects
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv'; // Path to the input CSV file
    
    console.log('Analyzing filtered CA drops...');
    
    // Read and process the CSV file asynchronously
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                // On each data (row) event, push the parsed row to results array
                results.push(row);
            })
            .on('end', () => {
                // Finished reading CSV: begin analysis
                console.log(`\n=== FILTERED CA DROPS ANALYSIS ===`);
                console.log(`Total filtered CA drops: ${results.length}`);
                
                // === Caller-based Analysis ===
                console.log(`\n=== TOP CALLERS ===`);
                const callerStats = {}; // Map from caller address to stats
                results.forEach(row => {
                    const caller = row['Sender'] || 'Unknown'; // Fallback for missing Sender
                    if (!callerStats[caller]) {
                        // Initialize the record for this caller
                        callerStats[caller] = {
                            count: 0,                // How many calls by this caller
                            chains: new Set(),       // Unique chains interacted with
                            tokens: new Set(),       // Unique tokens interacted with
                            addresses: new Set()     // Unique addresses called
                        };
                    }
                    // Update the stats for this caller
                    callerStats[caller].count++;
                    callerStats[caller].chains.add(row['Chain'] || 'Unknown');
                    callerStats[caller].tokens.add(row['Token Name'] || 'Unknown');
                    callerStats[caller].addresses.add(row['Address'] || 'Unknown');
                });
                
                // Output top callers by number of calls, with their details
                Object.entries(callerStats)
                    .sort(([,a], [,b]) => b.count - a.count)
                    .forEach(([caller, stats]) => {
                        console.log(`\n${caller}:`);
                        console.log(`  - Total calls: ${stats.count}`);
                        console.log(`  - Unique chains: ${stats.chains.size} (${Array.from(stats.chains).join(', ')})`);
                        console.log(`  - Unique tokens: ${stats.tokens.size}`);
                        console.log(`  - Unique addresses: ${stats.addresses.size}`);
                    });
                
                // === Chain Distribution Analysis ===
                console.log(`\n=== CHAIN DISTRIBUTION ===`);
                const chainStats = {}; // Map from chain name to number of calls
                results.forEach(row => {
                    const chain = row['Chain'] || 'Unknown';
                    chainStats[chain] = (chainStats[chain] || 0) + 1;
                });
                
                // Output chains sorted by number of calls
                Object.entries(chainStats)
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([chain, count]) => {
                        console.log(`${chain}: ${count} calls (${(count/results.length*100).toFixed(1)}%)`);
                    });
                
                // === Token Usage Pattern Analysis ===
                console.log(`\n=== TOKEN PATTERNS ===`);
                const tokenStats = {}; // Map from token name to call count
                results.forEach(row => {
                    const tokenName = row['Token Name'] || 'Unknown';
                    // Only count valid token names
                    if (tokenName !== 'N/A' && tokenName !== 'Unknown') {
                        tokenStats[tokenName] = (tokenStats[tokenName] || 0) + 1;
                    }
                });
                
                console.log('\nMost called tokens:');
                Object.entries(tokenStats)
                    .sort(([,a], [,b]) => b - a)    // Sort descending by count
                    .slice(0, 15)                   // Show top 15 tokens
                    .forEach(([token, count]) => {
                        console.log(`  ${token}: ${count} calls`);
                    });
                
                // === Time-of-Day Analysis ===
                console.log(`\n=== TIME ANALYSIS ===`);
                const timeStats = {}; // Map from UTC hour to call count
                results.forEach(row => {
                    const timestamp = row['Timestamp'];
                    if (timestamp) {
                        const date = new Date(timestamp); // Parse timestamp to date obj
                        const hour = date.getUTCHours(); // Extract the UTC hour
                        timeStats[hour] = (timeStats[hour] || 0) + 1;
                    }
                });
                
                console.log('\nCalls by hour (UTC):');
                Object.entries(timeStats)
                    .sort(([a], [b]) => a - b)             // Sort hours numerically
                    .forEach(([hour, count]) => {
                        console.log(`  ${hour}:00 UTC: ${count} calls`);
                    });
                
                // === Success Analysis: Tokens with Price Data ===
                console.log(`\n=== SUCCESS ANALYSIS ===`);
                // Filter rows that have both Call Price and Market Cap present and not N/A
                const withPrice = results.filter(row => 
                    row['Call Price'] && row['Call Price'] !== 'N/A' && 
                    row['Market Cap'] && row['Market Cap'] !== 'N/A'
                );
                
                console.log(`Tokens with price data: ${withPrice.length} (${(withPrice.length/results.length*100).toFixed(1)}%)`);
                
                if (withPrice.length > 0) {
                    // Collect price and market cap values as floats, filtering out non-numbers
                    const prices = withPrice.map(row => parseFloat(row['Call Price'])).filter(p => !isNaN(p));
                    const marketCaps = withPrice.map(row => parseFloat(row['Market Cap'])).filter(mc => !isNaN(mc));
                    
                    // Compute and print average and median call price, if available
                    if (prices.length > 0) {
                        // Average call price
                        console.log(`Average call price: $${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(6)}`);
                        // Median call price (for even count, lower-valued median used)
                        console.log(`Median call price: $${prices.sort((a,b) => a-b)[Math.floor(prices.length/2)].toFixed(6)}`);
                    }
                    
                    // Compute and print average and median market cap, if available
                    if (marketCaps.length > 0) {
                        // Average market cap
                        console.log(`Average market cap: $${(marketCaps.reduce((a,b) => a+b, 0) / marketCaps.length).toFixed(0)}`);
                        // Median market cap (for even count, lower-valued median used)
                        console.log(`Median market cap: $${marketCaps.sort((a,b) => a-b)[Math.floor(marketCaps.length/2)].toFixed(0)}`);
                    }
                }
                
                // === Generate Structured Analysis Report ===
                const report = {
                    summary: {
                        totalCalls: results.length,                            // Total rows
                        uniqueCallers: Object.keys(callerStats).length,       // Unique calling addresses
                        uniqueChains: Object.keys(chainStats).length,         // Unique chains
                        uniqueTokens: Object.keys(tokenStats).length,         // Unique tokens
                        callsWithPriceData: withPrice.length                  // Rows with price/market cap info
                    },
                    topCallers: Object.entries(callerStats)
                        .sort(([,a], [,b]) => b.count - a.count)
                        .slice(0, 10)
                        .map(([caller, stats]) => ({
                            caller,
                            count: stats.count,
                            chains: Array.from(stats.chains),
                            uniqueTokens: stats.tokens.size,
                            uniqueAddresses: stats.addresses.size
                        })),
                    chainDistribution: chainStats,        // Calls per chain
                    topTokens: Object.entries(tokenStats) // Top 20 tokens sorted descending
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 20),
                    timeDistribution: timeStats           // Hourly time-of-day call counts
                };
                
                // Write structured report to disk as JSON file
                fs.writeFileSync('/home/memez/quantBot/filtered_ca_drops_analysis.json', JSON.stringify(report, null, 2));
                console.log('\nDetailed analysis saved to filtered_ca_drops_analysis.json');
                
                resolve(report); // Fulfill the analysis promise with the report object
            })
            .on('error', reject); // If any stream error occurs, reject the promise
    });
}

// Run the analysis
analyzeFilteredCaDrops()
    .then(() => {
        // Log when analysis completes successfully
        console.log('\nAnalysis complete!');
    })
    .catch(console.error); // Output any errors in analysis
