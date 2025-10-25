const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Function to extract CA drops from HTML files
function extractCaDropsFromHtml(htmlContent, filename) {
    const $ = cheerio.load(htmlContent);
    const caDrops = [];
    
    // Find all message elements
    $('.message').each(function() {
        const $message = $(this);
        const messageId = $message.attr('id')?.replace('message-', '') || '';
        const username = $message.find('.from_name').text().trim();
        const timestamp = $message.find('.date').attr('title') || '';
        
        // Extract message text
        const messageText = $message.find('.text').text().trim();
        
        // Look for contract addresses in the message text
        const addressPatterns = [
            // Solana addresses (base58, 32-44 characters)
            /[1-9A-HJ-NP-Za-km-z]{32,44}/g,
            // Ethereum/BSC addresses (0x followed by 40 hex characters)
            /0x[a-fA-F0-9]{40}/g
        ];
        
        const addresses = [];
        addressPatterns.forEach(pattern => {
            const matches = messageText.match(pattern);
            if (matches) {
                addresses.push(...matches);
            }
        });
        
        // If we found addresses, create CA drop entries
        addresses.forEach(address => {
            // Determine chain based on address format
            let chain = 'unknown';
            if (address.startsWith('0x')) {
                chain = 'ethereum'; // Could be BSC too, but we'll use ethereum as default
            } else if (address.length >= 32 && address.length <= 44) {
                chain = 'solana';
            }
            
            caDrops.push({
                messageId,
                username,
                timestamp,
                address,
                chain,
                messageText,
                file: filename
            });
        });
    });
    
    return caDrops;
}

// Function to process all HTML files in brook2 directory
async function processBrook2Files() {
    const brook2Dir = '/home/memez/quantBot/messages/brook2';
    const files = fs.readdirSync(brook2Dir).filter(file => file.endsWith('.html'));
    
    console.log(`Found ${files.length} HTML files in brook2 directory:`, files);
    
    let allCaDrops = [];
    
    for (const file of files) {
        console.log(`Processing ${file}...`);
        const filePath = path.join(brook2Dir, file);
        const htmlContent = fs.readFileSync(filePath, 'utf8');
        
        const caDrops = extractCaDropsFromHtml(htmlContent, file);
        console.log(`  Found ${caDrops.length} CA drops in ${file}`);
        
        allCaDrops = allCaDrops.concat(caDrops);
    }
    
    console.log(`\nTotal CA drops found in brook2: ${allCaDrops.length}`);
    
    // Load existing filtered CA drops
    const existingCaDrops = JSON.parse(fs.readFileSync('/home/memez/quantBot/extracted_ca_drops.json', 'utf8'));
    console.log(`Existing CA drops: ${existingCaDrops.length}`);
    
    // Combine all CA drops
    const combinedCaDrops = [...existingCaDrops, ...allCaDrops];
    console.log(`Combined total CA drops: ${combinedCaDrops.length}`);
    
    // Save combined data
    fs.writeFileSync('/home/memez/quantBot/combined_ca_drops.json', JSON.stringify(combinedCaDrops, null, 2));
    console.log('Combined CA drops saved to combined_ca_drops.json');
    
    // Filter for your specific callers
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
    
    function normalizeCaller(caller) {
        return caller.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .replace(/\s+/g, '');
    }
    
    function isTargetCaller(caller) {
        const normalizedCaller = normalizeCaller(caller);
        return targetCallers.some(target => 
            normalizedCaller.includes(normalizeCaller(target)) || 
            normalizeCaller(target).includes(normalizedCaller)
        );
    }
    
    const filteredCaDrops = combinedCaDrops.filter(drop => isTargetCaller(drop.username));
    console.log(`Filtered CA drops for your callers: ${filteredCaDrops.length}`);
    
    // Save filtered data
    fs.writeFileSync('/home/memez/quantBot/expanded_filtered_ca_drops.json', JSON.stringify(filteredCaDrops, null, 2));
    console.log('Expanded filtered CA drops saved to expanded_filtered_ca_drops.json');
    
    // Convert to CSV format
    const csvData = filteredCaDrops.map(drop => ({
        'Message ID': drop.messageId,
        'Sender': drop.username,
        'Timestamp': drop.timestamp,
        'Raw Timestamp': drop.timestamp,
        'Address': drop.address,
        'Chain': drop.chain,
        'Token Name': 'N/A',
        'Token Symbol': 'N/A',
        'Decimals': 'N/A',
        'Call Price': 'N/A',
        'Market Cap': 'N/A',
        'Message Text': drop.messageText
    }));
    
    // Write CSV
    const csvContent = [
        'Message ID,Sender,Timestamp,Raw Timestamp,Address,Chain,Token Name,Token Symbol,Decimals,Call Price,Market Cap,Message Text',
        ...csvData.map(row => 
            `"${row['Message ID']}","${row['Sender']}","${row['Timestamp']}","${row['Raw Timestamp']}","${row['Address']}","${row['Chain']}","${row['Token Name']}","${row['Token Symbol']}","${row['Decimals']}","${row['Call Price']}","${row['Market Cap']}","${row['Message Text']}"`
        )
    ].join('\n');
    
    fs.writeFileSync('/home/memez/quantBot/expanded_filtered_ca_drops.csv', csvContent);
    console.log('Expanded filtered CA drops saved to expanded_filtered_ca_drops.csv');
    
    return {
        totalCaDrops: combinedCaDrops.length,
        filteredCaDrops: filteredCaDrops.length,
        filesProcessed: files.length
    };
}

// Run the processing
processBrook2Files()
    .then((results) => {
        console.log('\n=== BROOK2 PROCESSING COMPLETE ===');
        console.log(`Files processed: ${results.filesProcessed}`);
        console.log(`Total CA drops: ${results.totalCaDrops}`);
        console.log(`Filtered CA drops: ${results.filteredCaDrops}`);
        console.log('\nReady to run expanded simulations!');
    })
    .catch(console.error);
