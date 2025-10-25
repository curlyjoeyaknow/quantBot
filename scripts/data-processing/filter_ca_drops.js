const fs = require('fs'); // Node.js file system module for reading/writing files
const csv = require('csv-parser'); // CSV parsing library
const createCsvWriter = require('csv-writer').createObjectCsvWriter; // Library to write CSVs easily

// List of target caller names (allowed variants, normalization applied for matching)
const targetCallers = [
    'exy',
    'brook',
    'meta mxist',
    'brook giga I verify @brookcalls',
    'rektbighustla | @ourcryptohood owner',
    'davinch',
    'croz',
    'brook giga I verify @BrookCalls',   // different capitalization/canonicalizations
    'meta maxist',
    'RektBigHustla | @OurCryptoHood Owner'
];

// Normalize caller to lowercased, alphanumeric, no spaces (for loose fuzzy comparison)
function normalizeCaller(caller) {
    return caller.toLowerCase()              // make lowercase for non-case matching
        .replace(/[^a-z0-9]/g, '')           // remove all non-alphanumeric
        .replace(/\s+/g, '');                // ensure no whitespace
}

// Determine if a row's caller matches our desired targets (with normalization, partial match both ways)
function isTargetCaller(caller) {
    const normalizedCaller = normalizeCaller(caller);
    return targetCallers.some(target =>
        normalizedCaller.includes(normalizeCaller(target)) ||  // does our row contain normalized target variant?
        normalizeCaller(target).includes(normalizedCaller)     // or vice versa (catch abbreviations)
    );
}

// Determine if this row's token name or symbol looks like a known caller or known target token
function isTargetToken(tokenName, tokenSymbol) {
    // These are loose "substring" matches (partial, case-insensitive)
    const targetTerms = ['exy', 'brook', 'meta', 'mxist', 'giga', 'rekt', 'davinch', 'croz'];
    const name = (tokenName || '').toLowerCase();      // always lowercased for substring match
    const symbol = (tokenSymbol || '').toLowerCase();

    // If any of the target terms shows up in name or symbol
    return targetTerms.some(term =>
        name.includes(term) || symbol.includes(term)
    );
}

// Main filter function: read the input CSV, collect matching rows, write result CSV + JSON summary
async function filterCaDrops() {
    const results = [];  // collect matching rows here
    const inputFile = '/home/memez/quantBot/brook_ca_drops_2025-10-24.csv';     // CSV to filter

    console.log('Reading CA drops data...');

    // Wrap everything in a Promise for async flow (so you can await)
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)         // stream file as input
            .pipe(csv())                       // parse CSV rows as objects
            .on('data', (row) => {
                // For each row, check if we match one of our targets (by caller or token)
                const sender = row['Sender'] || '';
                const tokenName = row['Token Name'] || '';
                const tokenSymbol = row['Token Symbol'] || '';

                // Only include the row if it satisfies the user or token match rule
                if (isTargetCaller(sender) || isTargetToken(tokenName, tokenSymbol)) {
                    results.push(row);
                }
            })
            .on('end', () => {
                // Done processing all rows!
                console.log(`Found ${results.length} matching CA drops`);

                // Write filtered CA drops to output CSV (with specific field ordering)
                const csvWriter = createCsvWriter({
                    path: '/home/memez/quantBot/filtered_ca_drops.csv',
                    header: [
                        {id: 'Message ID', title: 'Message ID'},
                        {id: 'Sender', title: 'Sender'},
                        {id: 'Timestamp', title: 'Timestamp'},
                        {id: 'Raw Timestamp', title: 'Raw Timestamp'},
                        {id: 'Address', title: 'Address'},
                        {id: 'Chain', title: 'Chain'},
                        {id: 'Token Name', title: 'Token Name'},
                        {id: 'Token Symbol', title: 'Token Symbol'},
                        {id: 'Decimals', title: 'Decimals'},
                        {id: 'Call Price', title: 'Call Price'},
                        {id: 'Market Cap', title: 'Market Cap'},
                        {id: 'Message Text', title: 'Message Text'}
                    ]
                });

                // Actually write out the collected result set
                csvWriter.writeRecords(results)
                    .then(() => {
                        console.log('Filtered CA drops saved to filtered_ca_drops.csv');

                        // Additionally, create a summary object with statistics per category
                        const summary = {
                            totalFiltered: results.length, // overall count
                            byCaller: {}, // event count by caller name
                            byChain: {},  // event count by chain/coin
                            byToken: {}   // event count by token name
                        };

                        // Populate summary counts for each dimension
                        results.forEach(row => {
                            const sender = row['Sender'] || 'Unknown';
                            const chain = row['Chain'] || 'Unknown';
                            const tokenName = row['Token Name'] || 'Unknown';

                            summary.byCaller[sender] = (summary.byCaller[sender] || 0) + 1;
                            summary.byChain[chain] = (summary.byChain[chain] || 0) + 1;
                            summary.byToken[tokenName] = (summary.byToken[tokenName] || 0) + 1;
                        });

                        // Write the summary object as readable JSON
                        fs.writeFileSync('/home/memez/quantBot/filtered_ca_drops_summary.json', JSON.stringify(summary, null, 2));
                        console.log('Summary saved to filtered_ca_drops_summary.json');

                        // Done!
                        resolve(results);
                    })
                    .catch(reject);  // handle any CSV writing errors
            })
            .on('error', reject);   // handle any file read/CSV parse errors
    });
}

// Execute filter script when run directly
filterCaDrops()
    .then((results) => {
        // After completion, log summary table of top callers
        console.log(`\nFiltering complete! Found ${results.length} CA drops matching the criteria.`);
        console.log('\nTop callers:');
        const callerCounts = {};
        results.forEach(row => {
            const sender = row['Sender'] || 'Unknown';
            callerCounts[sender] = (callerCounts[sender] || 0) + 1;
        });

        // Print top 10 callers by count
        Object.entries(callerCounts)
            .sort(([,a], [,b]) => b - a) // sort descending by count
            .slice(0, 10)                // only show top 10
            .forEach(([caller, count]) => {
                console.log(`  ${caller}: ${count} calls`);
            });
    })
    .catch(console.error); // Log any errors if promise fails
