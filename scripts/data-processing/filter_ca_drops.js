const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Define the target callers/tokens to filter for
const targetCallers = [
    'exy',
    'brook',
    'meta mxist',
    'brook giga I verify @brookcalls',
    'rektbighustla | @ourcryptohood owner',
    'davinch',
    'croz',
    'brook giga I verify @BrookCalls',
    'meta maxist',
    'RektBigHustla | @OurCryptoHood Owner'
];

// Function to normalize caller names for comparison
function normalizeCaller(caller) {
    return caller.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
}

// Function to check if a caller matches our targets
function isTargetCaller(caller) {
    const normalizedCaller = normalizeCaller(caller);
    return targetCallers.some(target => 
        normalizedCaller.includes(normalizeCaller(target)) || 
        normalizeCaller(target).includes(normalizedCaller)
    );
}

// Function to check if token name/symbol contains target terms
function isTargetToken(tokenName, tokenSymbol) {
    const targetTerms = ['exy', 'brook', 'meta', 'mxist', 'giga', 'rekt', 'davinch', 'croz'];
    const name = (tokenName || '').toLowerCase();
    const symbol = (tokenSymbol || '').toLowerCase();
    
    return targetTerms.some(term => 
        name.includes(term) || symbol.includes(term)
    );
}

async function filterCaDrops() {
    const results = [];
    const inputFile = '/home/memez/quantBot/brook_ca_drops_2025-10-24.csv';
    
    console.log('Reading CA drops data...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                const sender = row['Sender'] || '';
                const tokenName = row['Token Name'] || '';
                const tokenSymbol = row['Token Symbol'] || '';
                
                // Check if this row matches our criteria
                if (isTargetCaller(sender) || isTargetToken(tokenName, tokenSymbol)) {
                    results.push(row);
                }
            })
            .on('end', () => {
                console.log(`Found ${results.length} matching CA drops`);
                
                // Write filtered results to CSV
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
                
                csvWriter.writeRecords(results)
                    .then(() => {
                        console.log('Filtered CA drops saved to filtered_ca_drops.csv');
                        
                        // Also create a summary
                        const summary = {
                            totalFiltered: results.length,
                            byCaller: {},
                            byChain: {},
                            byToken: {}
                        };
                        
                        results.forEach(row => {
                            const sender = row['Sender'] || 'Unknown';
                            const chain = row['Chain'] || 'Unknown';
                            const tokenName = row['Token Name'] || 'Unknown';
                            
                            summary.byCaller[sender] = (summary.byCaller[sender] || 0) + 1;
                            summary.byChain[chain] = (summary.byChain[chain] || 0) + 1;
                            summary.byToken[tokenName] = (summary.byToken[tokenName] || 0) + 1;
                        });
                        
                        fs.writeFileSync('/home/memez/quantBot/filtered_ca_drops_summary.json', JSON.stringify(summary, null, 2));
                        console.log('Summary saved to filtered_ca_drops_summary.json');
                        
                        resolve(results);
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}

// Run the filtering
filterCaDrops()
    .then((results) => {
        console.log(`\nFiltering complete! Found ${results.length} CA drops matching the criteria.`);
        console.log('\nTop callers:');
        const callerCounts = {};
        results.forEach(row => {
            const sender = row['Sender'] || 'Unknown';
            callerCounts[sender] = (callerCounts[sender] || 0) + 1;
        });
        
        Object.entries(callerCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([caller, count]) => {
                console.log(`  ${caller}: ${count} calls`);
            });
    })
    .catch(console.error);
