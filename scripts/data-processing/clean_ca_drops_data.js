const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Function to clean and filter CA drops data
function cleanCaDropsData() {
    const inputFile = '/home/memez/quantBot/expanded_filtered_ca_drops.csv';
    const cleanedData = [];
    
    console.log('Cleaning CA drops data...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                const sender = row['Sender'] || '';
                
                // Skip rows with empty sender, timestamps, or malformed data
                if (!sender || 
                    sender === '' || 
                    sender.includes('UTC+10:00') || 
                    sender.includes('2025') ||
                    sender === 'Sender' ||
                    sender.length < 3) {
                    return;
                }
                
                // Clean up sender names
                let cleanSender = sender.replace(/"/g, '').trim();
                
                // Map similar names to consistent ones
                if (cleanSender.includes('Brook Giga') || cleanSender.includes('BrookCalls')) {
                    cleanSender = 'Brook Giga I verify @BrookCalls';
                } else if (cleanSender.includes('Brook 💀🧲') || cleanSender.includes('Brook Calls')) {
                    cleanSender = 'Brook 💀🧲';
                } else if (cleanSender.includes('RektBigHustla') || cleanSender.includes('OurCryptoHood')) {
                    cleanSender = 'RektBigHustla | @OurCryptoHood Owner';
                } else if (cleanSender.includes('meta maxist') || cleanSender.includes('meta maxist')) {
                    cleanSender = 'meta maxist';
                }
                
                // Only include known good callers
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
                
                if (validCallers.includes(cleanSender)) {
                    cleanedData.push({
                        'Message ID': row['Message ID'],
                        'Sender': cleanSender,
                        'Timestamp': row['Timestamp'],
                        'Raw Timestamp': row['Raw Timestamp'],
                        'Address': row['Address'],
                        'Chain': row['Chain'],
                        'Token Name': row['Token Name'],
                        'Token Symbol': row['Token Symbol'],
                        'Decimals': row['Decimals'],
                        'Call Price': row['Call Price'],
                        'Market Cap': row['Market Cap'],
                        'Message Text': row['Message Text']
                    });
                }
            })
            .on('end', () => {
                console.log(`Cleaned data: ${cleanedData.length} valid CA drops`);
                
                // Show distribution by caller
                const callerCounts = {};
                cleanedData.forEach(row => {
                    const caller = row['Sender'];
                    callerCounts[caller] = (callerCounts[caller] || 0) + 1;
                });
                
                console.log('\nCaller distribution:');
                Object.entries(callerCounts).forEach(([caller, count]) => {
                    console.log(`  ${caller}: ${count} calls`);
                });
                
                // Write cleaned CSV
                const csvContent = [
                    'Message ID,Sender,Timestamp,Raw Timestamp,Address,Chain,Token Name,Token Symbol,Decimals,Call Price,Market Cap,Message Text',
                    ...cleanedData.map(row => 
                        `"${row['Message ID']}","${row['Sender']}","${row['Timestamp']}","${row['Raw Timestamp']}","${row['Address']}","${row['Chain']}","${row['Token Name']}","${row['Token Symbol']}","${row['Decimals']}","${row['Call Price']}","${row['Market Cap']}","${row['Message Text']}"`
                    )
                ].join('\n');
                
                fs.writeFileSync('/home/memez/quantBot/cleaned_ca_drops.csv', csvContent);
                console.log('\nCleaned data saved to cleaned_ca_drops.csv');
                
                resolve(cleanedData);
            })
            .on('error', reject);
    });
}

// Run the cleaning
cleanCaDropsData()
    .then((cleanedData) => {
        console.log(`\nCleaning complete! ${cleanedData.length} valid CA drops ready for simulation.`);
        console.log('No more "Unknown" callers - all data is properly attributed!');
    })
    .catch(console.error);
