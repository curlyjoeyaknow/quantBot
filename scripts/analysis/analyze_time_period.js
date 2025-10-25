const fs = require('fs');
const csv = require('csv-parser');

/**
 * Analyzes the time range and trading statistics of CA drops from a CSV file.
 * Computes summary statistics about the period, frequency, and hypothetical returns.
 */
async function analyzeTimePeriod() {
    const timestamps = []; // Will hold all parsed timestamps from the CSV
    const inputFile = '/home/memez/quantBot/filtered_ca_drops.csv'; // Path to input data

    console.log('Analyzing time period of CA drops data...');

    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                if (row['Timestamp']) {
                    // Parse and push timestamp as a Date object
                    timestamps.push(new Date(row['Timestamp']));
                }
            })
            .on('end', () => {
                if (timestamps.length === 0) {
                    // No data found, bail out gracefully.
                    console.log('No timestamps found');
                    resolve(null);
                    return;
                }

                // Sort all Date objects in ascending order
                timestamps.sort((a, b) => a - b);

                // Establish the beginning and end of the dataset
                const startDate = timestamps[0];
                const endDate = timestamps[timestamps.length - 1];

                // Calculate total duration of data in days and hours
                // (Adding 1 to duration would count both start and end as inclusive, but here we use the precise elapsed time)
                const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)); // Millis in a day
                const totalHours = Math.ceil((endDate - startDate) / (1000 * 60 * 60));      // Millis in an hour

                console.log('\n=== TIME PERIOD ANALYSIS ===');
                // Print start and end in ISO string for clarity
                console.log(`Start Date: ${startDate.toISOString().split('T')[0]} ${startDate.toISOString().split('T')[1].split('.')[0]} UTC`);
                console.log(`End Date: ${endDate.toISOString().split('T')[0]} ${endDate.toISOString().split('T')[1].split('.')[0]} UTC`);
                console.log(`Total Period: ${totalDays} days (${totalHours} hours)`);
                console.log(`Total CA Drops: ${timestamps.length}`);

                // Calculate frequency statistics (average trades per day/hour)
                const tradesPerDay = timestamps.length / totalDays;
                console.log(`Average CA Drops per Day: ${tradesPerDay.toFixed(2)}`);

                const tradesPerHour = timestamps.length / totalHours;
                console.log(`Average CA Drops per Hour: ${tradesPerHour.toFixed(2)}`);

                // Print period summary (dates are hardcoded & should be generalized if needed)
                console.log(`\nPeriod Summary:`);
                console.log(`- From: September 19, 2025`);
                console.log(`- To: October 24, 2025`);
                console.log(`- Duration: ${totalDays} days`);
                console.log(`- Total Trades Simulated: 146 (20 per caller)`);

                // All returns calculations use the hardcoded total return (21.5549x), for demonstration
                // Calculate annualized return using exponentiation for compounding
                const annualizedReturn = Math.pow(21.5549, 365 / totalDays) - 1; // Converts total return to equivalent annual rate
                console.log(`\n=== ANNUALIZED PERFORMANCE ===`);
                console.log(`Total Return: 2,155.49% over ${totalDays} days`);
                console.log(`Annualized Return: ${(annualizedReturn * 100).toFixed(2)}%`);

                // Calculate geometric average daily return
                const dailyReturn = Math.pow(21.5549, 1 / totalDays) - 1;
                console.log(`Daily Return: ${(dailyReturn * 100).toFixed(2)}%`);

                // Calculate geometric average monthly return (30-day period)
                const monthlyReturn = Math.pow(21.5549, 30 / totalDays) - 1;
                console.log(`Monthly Return: ${(monthlyReturn * 100).toFixed(2)}%`);

                // Pack results in an analysis object for later use or writing to disk
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

                // Save the summary statistics and time period analysis to disk
                fs.writeFileSync('/home/memez/quantBot/time_period_analysis.json', JSON.stringify(analysis, null, 2));
                console.log('\nTime period analysis saved to time_period_analysis.json');

                // Fulfill caller with the computed results
                resolve(analysis);
            })
            .on('error', reject); // Handle file errors
    });
}

// Run the analysis, print summary of findings
analyzeTimePeriod()
    .then((analysis) => {
        if (analysis) {
            // Recap performance statistics in an extra summary
            console.log('\n=== SUMMARY ===');
            console.log(`Your strategy generated 2,155% returns over ${analysis.totalDays} days`);
            console.log(`That's equivalent to ${analysis.annualizedReturn}% annually!`);
            console.log(`Daily average: ${analysis.dailyReturn}%`);
            console.log(`Monthly average: ${analysis.monthlyReturn}%`);
        }
    })
    .catch(console.error); // Alert on top-level errors
