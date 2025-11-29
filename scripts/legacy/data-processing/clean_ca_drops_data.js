const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Function to clean and filter CA drops data with detailed inline comments
function cleanCaDropsData() {
    const inputFile = '/home/memez/quantBot/expanded_filtered_ca_drops.csv'; // Input CSV with expanded CA drops
    const cleanedData = []; // Store rows that pass cleaning/validity

    console.log('Cleaning CA drops data...');

    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                const sender = row['Sender'] || '';
                
                // Skip rows with clear problems or meaningless values:
                // - empty/missing sender
                // - sender==header name
                // - sender with timezone artifacts
                // - sender with probable timestamp instead of name
                // - sender string is suspiciously short
                if (
                    !sender || 
                    sender === '' || 
                    sender.includes('UTC+10:00') || // bad parse - timezone instead of sender
                    sender.includes('2025') ||       // likely timestamp/faulty extraction
                    sender === 'Sender' ||           // header row or bad record
                    sender.length < 3                // not a real name
                ) {
                    return; // skip this record
                }

                // Remove stray quotes and whitespace from sender
                let cleanSender = sender.replace(/"/g, '').trim();

                // Normalize sender variations to canonical display:
                // Example: several "Brook Giga" name variants
                if (cleanSender.includes('Brook Giga') || cleanSender.includes('BrookCalls')) {
                    cleanSender = 'Brook Giga I verify @BrookCalls';
                } else if (cleanSender.includes('Brook 💀🧲') || cleanSender.includes('Brook Calls')) {
                    cleanSender = 'Brook 💀🧲';
                } else if (cleanSender.includes('RektBigHustla') || cleanSender.includes('OurCryptoHood')) {
                    cleanSender = 'RektBigHustla | @OurCryptoHood Owner';
                } else if (cleanSender.includes('meta maxist')) {
                    // Note: duplicated "meta maxist" check kept for completeness, no effect
                    cleanSender = 'meta maxist';
                }

                // Allow only recognized/known caller names (prevents spam/junk/noise)
                const validCallers = [
                    'Brook Giga I verify @BrookCalls',
                    'Brook 💀🧲',
                    'Croz',
                    'davinch',
                    'meta maxist',
                    'Brook',
                    'exy',
                    'RektBigHustla | @OurCryptoHood Owner',
                    'ʟ ᴇ ᴍ ᴏ ɴ ᴄ ʜ ɪ ʟ ᴅ 🍋'
                ];

                // Only collect record if it matches a valid caller name
                if (validCallers.includes(cleanSender)) {
                    // Push cleaned / normalized row into cleanedData array
                    cleanedData.push({
                        'Message ID': row['Message ID'],                  // Telegram message ID
                        'Sender': cleanSender,                            // Normalized caller name
                        'Timestamp': row['Timestamp'],                    // Human-readable parsed timestamp
                        'Raw Timestamp': row['Raw Timestamp'],            // Original raw timestamp (from message)
                        'Address': row['Address'],                        // CA (contract address)
                        'Chain': row['Chain'],                            // Chain name (e.g. SOL, ETH)
                        'Token Name': row['Token Name'],                  // Detected token name
                        'Token Symbol': row['Token Symbol'],              // Ticker/symbol
                        'Decimals': row['Decimals'],                      // Token decimals
                        'Call Price': row['Call Price'],                  // Price at time of CA drop
                        'Market Cap': row['Market Cap'],                  // Market cap at drop time
                        'Message Text': row['Message Text']               // Original Telegram message text
                    });
                }
            })
            .on('end', () => {
                // Finished parsing and cleaning all records
                console.log(`Cleaned data: ${cleanedData.length} valid CA drops`);

                // Calculate the distribution/frequency of drops by each caller
                const callerCounts = {};
                cleanedData.forEach(row => {
                    const caller = row['Sender'];
                    callerCounts[caller] = (callerCounts[caller] || 0) + 1; // Increment per caller
                });

                // Display how many valid drops per caller (for quick verification)
                console.log('\nCaller distribution:');
                Object.entries(callerCounts).forEach(([caller, count]) => {
                    console.log(`  ${caller}: ${count} calls`);
                });

                // Compose cleaned CSV output: CSV header + each row as quoted CSV
                const csvContent = [
                    'Message ID,Sender,Timestamp,Raw Timestamp,Address,Chain,Token Name,Token Symbol,Decimals,Call Price,Market Cap,Message Text',
                    ...cleanedData.map(row =>
                        `"${row['Message ID']}","${row['Sender']}","${row['Timestamp']}","${row['Raw Timestamp']}","${row['Address']}","${row['Chain']}","${row['Token Name']}","${row['Token Symbol']}","${row['Decimals']}","${row['Call Price']}","${row['Market Cap']}","${row['Message Text']}"`
                    )
                ].join('\n');

                // Write output to disk as a new clean CSV file
                fs.writeFileSync('/home/memez/quantBot/cleaned_ca_drops.csv', csvContent); // Overwrites existing file

                console.log('\nCleaned data saved to cleaned_ca_drops.csv');

                // Resolution: return array of cleaned records
                resolve(cleanedData);
            })
            .on('error', reject); // Forward file/parse errors to the caller
    });
}

// Run the cleaning process and log overall result summary
cleanCaDropsData()
    .then((cleanedData) => {
        // Report total count and confirm all names resolved
        console.log(`\nCleaning complete! ${cleanedData.length} valid CA drops ready for simulation.`);
        console.log('No more "Unknown" callers - all data is properly attributed!');
    })
    .catch(console.error);
