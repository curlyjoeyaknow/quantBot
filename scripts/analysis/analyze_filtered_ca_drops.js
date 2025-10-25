const fs = require('fs');
const csv = require('csv-parser');

async function analyzeFilteredCaDrops() {
    const results = [];
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv';
    
    console.log('Analyzing filtered CA drops...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                results.push(row);
            })
            .on('end', () => {
                console.log(`\n=== FILTERED CA DROPS ANALYSIS ===`);
                console.log(`Total filtered CA drops: ${results.length}`);
                
                // Analysis by caller
                console.log(`\n=== TOP CALLERS ===`);
                const callerStats = {};
                results.forEach(row => {
                    const caller = row['Sender'] || 'Unknown';
                    if (!callerStats[caller]) {
                        callerStats[caller] = {
                            count: 0,
                            chains: new Set(),
                            tokens: new Set(),
                            addresses: new Set()
                        };
                    }
                    callerStats[caller].count++;
                    callerStats[caller].chains.add(row['Chain'] || 'Unknown');
                    callerStats[caller].tokens.add(row['Token Name'] || 'Unknown');
                    callerStats[caller].addresses.add(row['Address'] || 'Unknown');
                });
                
                Object.entries(callerStats)
                    .sort(([,a], [,b]) => b.count - a.count)
                    .forEach(([caller, stats]) => {
                        console.log(`\n${caller}:`);
                        console.log(`  - Total calls: ${stats.count}`);
                        console.log(`  - Unique chains: ${stats.chains.size} (${Array.from(stats.chains).join(', ')})`);
                        console.log(`  - Unique tokens: ${stats.tokens.size}`);
                        console.log(`  - Unique addresses: ${stats.addresses.size}`);
                    });
                
                // Analysis by chain
                console.log(`\n=== CHAIN DISTRIBUTION ===`);
                const chainStats = {};
                results.forEach(row => {
                    const chain = row['Chain'] || 'Unknown';
                    chainStats[chain] = (chainStats[chain] || 0) + 1;
                });
                
                Object.entries(chainStats)
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([chain, count]) => {
                        console.log(`${chain}: ${count} calls (${(count/results.length*100).toFixed(1)}%)`);
                    });
                
                // Analysis by token patterns
                console.log(`\n=== TOKEN PATTERNS ===`);
                const tokenStats = {};
                results.forEach(row => {
                    const tokenName = row['Token Name'] || 'Unknown';
                    if (tokenName !== 'N/A' && tokenName !== 'Unknown') {
                        tokenStats[tokenName] = (tokenStats[tokenName] || 0) + 1;
                    }
                });
                
                console.log('\nMost called tokens:');
                Object.entries(tokenStats)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 15)
                    .forEach(([token, count]) => {
                        console.log(`  ${token}: ${count} calls`);
                    });
                
                // Time analysis
                console.log(`\n=== TIME ANALYSIS ===`);
                const timeStats = {};
                results.forEach(row => {
                    const timestamp = row['Timestamp'];
                    if (timestamp) {
                        const date = new Date(timestamp);
                        const hour = date.getUTCHours();
                        timeStats[hour] = (timeStats[hour] || 0) + 1;
                    }
                });
                
                console.log('\nCalls by hour (UTC):');
                Object.entries(timeStats)
                    .sort(([a], [b]) => a - b)
                    .forEach(([hour, count]) => {
                        console.log(`  ${hour}:00 UTC: ${count} calls`);
                    });
                
                // Success analysis (tokens with price data)
                console.log(`\n=== SUCCESS ANALYSIS ===`);
                const withPrice = results.filter(row => 
                    row['Call Price'] && row['Call Price'] !== 'N/A' && 
                    row['Market Cap'] && row['Market Cap'] !== 'N/A'
                );
                
                console.log(`Tokens with price data: ${withPrice.length} (${(withPrice.length/results.length*100).toFixed(1)}%)`);
                
                if (withPrice.length > 0) {
                    const prices = withPrice.map(row => parseFloat(row['Call Price'])).filter(p => !isNaN(p));
                    const marketCaps = withPrice.map(row => parseFloat(row['Market Cap'])).filter(mc => !isNaN(mc));
                    
                    if (prices.length > 0) {
                        console.log(`Average call price: $${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(6)}`);
                        console.log(`Median call price: $${prices.sort((a,b) => a-b)[Math.floor(prices.length/2)].toFixed(6)}`);
                    }
                    
                    if (marketCaps.length > 0) {
                        console.log(`Average market cap: $${(marketCaps.reduce((a,b) => a+b, 0) / marketCaps.length).toFixed(0)}`);
                        console.log(`Median market cap: $${marketCaps.sort((a,b) => a-b)[Math.floor(marketCaps.length/2)].toFixed(0)}`);
                    }
                }
                
                // Create detailed report
                const report = {
                    summary: {
                        totalCalls: results.length,
                        uniqueCallers: Object.keys(callerStats).length,
                        uniqueChains: Object.keys(chainStats).length,
                        uniqueTokens: Object.keys(tokenStats).length,
                        callsWithPriceData: withPrice.length
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
                    chainDistribution: chainStats,
                    topTokens: Object.entries(tokenStats)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 20),
                    timeDistribution: timeStats
                };
                
                fs.writeFileSync('/home/memez/quantBot/filtered_ca_drops_analysis.json', JSON.stringify(report, null, 2));
                console.log('\nDetailed analysis saved to filtered_ca_drops_analysis.json');
                
                resolve(report);
            })
            .on('error', reject);
    });
}

// Run the analysis
analyzeFilteredCaDrops()
    .then(() => {
        console.log('\nAnalysis complete!');
    })
    .catch(console.error);
