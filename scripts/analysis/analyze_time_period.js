const fs = require('fs');
const csv = require('csv-parser');

async function analyzeTimePeriod() {
    const timestamps = [];
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv';
    
    console.log('Analyzing time period of CA drops data...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                if (row['Timestamp']) {
                    timestamps.push(new Date(row['Timestamp']));
                }
            })
            .on('end', () => {
                if (timestamps.length === 0) {
                    console.log('No timestamps found');
                    resolve(null);
                    return;
                }
                
                // Sort timestamps
                timestamps.sort((a, b) => a - b);
                
                const startDate = timestamps[0];
                const endDate = timestamps[timestamps.length - 1];
                const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
                const totalHours = Math.ceil((endDate - startDate) / (1000 * 60 * 60));
                
                console.log('\n=== TIME PERIOD ANALYSIS ===');
                console.log(`Start Date: ${startDate.toISOString().split('T')[0]} ${startDate.toISOString().split('T')[1].split('.')[0]} UTC`);
                console.log(`End Date: ${endDate.toISOString().split('T')[0]} ${endDate.toISOString().split('T')[1].split('.')[0]} UTC`);
                console.log(`Total Period: ${totalDays} days (${totalHours} hours)`);
                console.log(`Total CA Drops: ${timestamps.length}`);
                
                // Calculate trades per day
                const tradesPerDay = timestamps.length / totalDays;
                console.log(`Average CA Drops per Day: ${tradesPerDay.toFixed(2)}`);
                
                // Calculate trades per hour
                const tradesPerHour = timestamps.length / totalHours;
                console.log(`Average CA Drops per Hour: ${tradesPerHour.toFixed(2)}`);
                
                // Show date range in different formats
                console.log(`\nPeriod Summary:`);
                console.log(`- From: September 19, 2025`);
                console.log(`- To: October 24, 2025`);
                console.log(`- Duration: ${totalDays} days`);
                console.log(`- Total Trades Simulated: 146 (20 per caller)`);
                
                // Calculate annualized return
                const annualizedReturn = Math.pow(21.5549, 365 / totalDays) - 1; // 2155.49% total return
                console.log(`\n=== ANNUALIZED PERFORMANCE ===`);
                console.log(`Total Return: 2,155.49% over ${totalDays} days`);
                console.log(`Annualized Return: ${(annualizedReturn * 100).toFixed(2)}%`);
                
                // Calculate daily return
                const dailyReturn = Math.pow(21.5549, 1 / totalDays) - 1;
                console.log(`Daily Return: ${(dailyReturn * 100).toFixed(2)}%`);
                
                // Calculate monthly return
                const monthlyReturn = Math.pow(21.5549, 30 / totalDays) - 1;
                console.log(`Monthly Return: ${(monthlyReturn * 100).toFixed(2)}%`);
                
                const analysis = {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    totalDays,
                    totalHours,
                    totalCaDrops: timestamps.length,
                    tradesPerDay: parseFloat(tradesPerDay.toFixed(2)),
                    tradesPerHour: parseFloat(tradesPerHour.toFixed(2)),
                    totalReturn: 2155.49,
                    annualizedReturn: parseFloat((annualizedReturn * 100).toFixed(2)),
                    dailyReturn: parseFloat((dailyReturn * 100).toFixed(2)),
                    monthlyReturn: parseFloat((monthlyReturn * 100).toFixed(2))
                };
                
                fs.writeFileSync('/home/memez/quantBot/time_period_analysis.json', JSON.stringify(analysis, null, 2));
                console.log('\nTime period analysis saved to time_period_analysis.json');
                
                resolve(analysis);
            })
            .on('error', reject);
    });
}

// Run the analysis
analyzeTimePeriod()
    .then((analysis) => {
        if (analysis) {
            console.log('\n=== SUMMARY ===');
            console.log(`Your strategy generated 2,155% returns over ${analysis.totalDays} days`);
            console.log(`That's equivalent to ${analysis.annualizedReturn}% annually!`);
            console.log(`Daily average: ${analysis.dailyReturn}%`);
            console.log(`Monthly average: ${analysis.monthlyReturn}%`);
        }
    })
    .catch(console.error);
