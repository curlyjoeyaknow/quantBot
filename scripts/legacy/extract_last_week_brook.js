const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');

// Configuration
const BROOK_DATA_DIR = path.join(__dirname, 'data/raw/messages');
const OUTPUT_DIR = path.join(__dirname, 'data/exports/csv');
const OUTPUT_CSV_PATH = path.join(OUTPUT_DIR, 'brook_last_week_calls.csv');
const SIMULATION_SCRIPT_PATH = path.join(__dirname, 'batch_simulation.js');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Function to parse timestamp string into a Date object
function parseTimestamp(timestampStr) {
  try {
    const cleanTimestamp = timestampStr.replace(/"/g, '');
    const parts = cleanTimestamp.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/);
    if (parts) {
      const [, day, month, year, hour, minute, second, tzSign, tzMinute] = parts;
      const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}:${tzMinute}`;
      return new Date(isoString);
    }
    return new Date('Invalid Date');
  } catch (e) {
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date('Invalid Date');
  }
}

// Function to extract CA drops from HTML file
function extractCADropsFromHTML(filePath) {
  console.log(`📄 Processing ${filePath}...`);
  
  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(htmlContent);
  const caDrops = [];

  $('.message.default.clearfix').each((index, element) => {
    const $msg = $(element);
    const messageId = $msg.attr('id')?.replace('message-', '') || '';
    const sender = $msg.find('.from_name').text().trim();
    const timestampElement = $msg.find('.date.details');
    const timestamp = timestampElement.attr('title') || timestampElement.text().trim();
    const messageText = $msg.find('.text').html() || $msg.find('.text').text().trim();

    // Look for token addresses in the message
    const solanaAddressMatch = messageText.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    const evmAddressMatch = messageText.match(/0x[a-fA-F0-9]{40}/);

    if (solanaAddressMatch || evmAddressMatch) {
      const address = solanaAddressMatch ? solanaAddressMatch[0] : evmAddressMatch[0];
      const chain = solanaAddressMatch ? 'solana' : 'bsc';
      
      // Extract token name and symbol if available
      const tokenNameMatch = messageText.match(/Token Name: ([^,<]+)/);
      const tokenSymbolMatch = messageText.match(/Token Symbol: ([^,<]+)/);
      
      // Extract token name from the message text (look for patterns like "TokenName ($SYMBOL)")
      const tokenPattern = messageText.match(/([A-Za-z0-9\s]+)\s*\(\$([A-Za-z0-9]+)\)/);
      const extractedTokenName = tokenPattern ? tokenPattern[1].trim() : (tokenNameMatch ? tokenNameMatch[1] : 'N/A');
      const extractedTokenSymbol = tokenPattern ? tokenPattern[2] : (tokenSymbolMatch ? tokenSymbolMatch[1] : 'N/A');
      
      caDrops.push({
        'Message ID': messageId,
        'Sender': sender,
        'Timestamp': timestamp,
        'Raw Timestamp': timestamp,
        'Address': address,
        'Chain': chain,
        'Token Name': extractedTokenName,
        'Token Symbol': extractedTokenSymbol,
        'Decimals': 'N/A',
        'Call Price': 'N/A',
        'Market Cap': 'N/A',
        'Message Text': messageText.replace(/<[^>]*>/g, ' ') // Remove HTML tags for cleaner text
      });
    }
  });

  return caDrops;
}

// Function to get all Brook HTML files
function getAllBrookFiles() {
  const brookFiles = [];
  
  // Check brook, brook2, brook3 folders
  ['brook', 'brook2', 'brook3'].forEach(folder => {
    const folderPath = path.join(BROOK_DATA_DIR, folder);
    if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.html'))
        .map(file => path.join(folderPath, file));
      brookFiles.push(...files);
    }
  });
  
  // Also check root messages files
  const rootFiles = fs.readdirSync(BROOK_DATA_DIR)
    .filter(file => file.startsWith('messages') && file.endsWith('.html'))
    .map(file => path.join(BROOK_DATA_DIR, file));
  brookFiles.push(...rootFiles);
  
  return brookFiles;
}

// Function to filter last week of data
function filterLastWeek(caDrops) {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  
  console.log(`📅 Filtering data from ${oneWeekAgo.toISOString()} to ${now.toISOString()}`);
  
  const filteredDrops = caDrops.filter(drop => {
    const timestamp = parseTimestamp(drop['Raw Timestamp']);
    return timestamp >= oneWeekAgo && timestamp <= now;
  });
  
  console.log(`📊 Found ${filteredDrops.length} calls from the last week (out of ${caDrops.length} total)`);
  return filteredDrops;
}

// Main extraction function
async function extractLastWeekBrookCalls() {
  console.log('🚀 Extracting last week of Brook calls...');
  
  const allBrookFiles = getAllBrookFiles();
  console.log(`📁 Found ${allBrookFiles.length} Brook HTML files to process`);
  
  let allCADrops = [];
  
  // Process all HTML files
  for (const filePath of allBrookFiles) {
    try {
      const caDrops = extractCADropsFromHTML(filePath);
      allCADrops.push(...caDrops);
    } catch (error) {
      console.error(`❌ Error processing ${filePath}:`, error.message);
    }
  }
  
  console.log(`📊 Total CA drops extracted: ${allCADrops.length}`);
  
  // Filter for last week
  const lastWeekDrops = filterLastWeek(allCADrops);
  
  if (lastWeekDrops.length === 0) {
    console.log('⚠️ No calls found in the last week. Using all available data instead.');
    // If no data in last week, use all data
    const allData = allCADrops;
    await saveToCSV(allData);
    return allData;
  }
  
  // Save to CSV
  await saveToCSV(lastWeekDrops);
  
  return lastWeekDrops;
}

// Function to save data to CSV
async function saveToCSV(caDrops) {
  return new Promise((resolve, reject) => {
    const headers = [
      'Message ID', 'Sender', 'Timestamp', 'Raw Timestamp', 'Address', 'Chain',
      'Token Name', 'Token Symbol', 'Decimals', 'Call Price', 'Market Cap', 'Message Text'
    ];
    
    stringify(caDrops, { header: true, columns: headers }, (err, output) => {
      if (err) {
        reject(err);
        return;
      }
      
      fs.writeFileSync(OUTPUT_CSV_PATH, output);
      console.log(`💾 Saved ${caDrops.length} CA drops to: ${OUTPUT_CSV_PATH}`);
      resolve();
    });
  });
}

// Function to run backtest simulation
async function runBacktestSimulation() {
  console.log('\n🎯 Running backtest simulation on last week data...');
  
  // Update the batch simulation script to use our new CSV file
  const batchScriptContent = fs.readFileSync(SIMULATION_SCRIPT_PATH, 'utf8');
  const updatedScriptContent = batchScriptContent.replace(
    /const INPUT_CSV_PATH = path\.join\(__dirname, '[^']+'\);/,
    `const INPUT_CSV_PATH = path.join(__dirname, 'data/exports/csv/brook_last_week_calls.csv');`
  );
  
  const tempScriptPath = path.join(__dirname, 'temp_last_week_simulation.js');
  fs.writeFileSync(tempScriptPath, updatedScriptContent);
  
  console.log('📈 Starting simulation...');
  
  // Run the simulation
  const { spawn } = require('child_process');
  const simulation = spawn('node', [tempScriptPath], { stdio: 'inherit' });
  
  simulation.on('close', (code) => {
    console.log(`\n✅ Simulation completed with exit code: ${code}`);
    
    // Clean up temp file
    fs.unlinkSync(tempScriptPath);
    
    // Show results
    const resultsPath = path.join(__dirname, 'batch_simulation_results.json');
    if (fs.existsSync(resultsPath)) {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      console.log('\n📊 === SIMULATION RESULTS ===');
      console.log(`💰 Initial Balance: ${results.initialSOLBalance} SOL`);
      console.log(`💰 Final Balance: ${results.finalSOLBalance.toFixed(4)} SOL`);
      console.log(`📈 Total Return: ${results.totalReturn.toFixed(2)}%`);
      console.log(`🔄 Total Trades: ${results.totalTrades}`);
      console.log(`🎯 Win Rate: ${results.winRate.toFixed(2)}%`);
      console.log(`🔄 Re-entry Rate: ${results.reentryRate.toFixed(2)}%`);
      console.log(`🛑 Stop Losses: ${results.totalStopLosses}`);
      console.log(`🎯 Take Profits: ${results.totalTakeProfits}`);
      console.log(`⏰ Timeouts: ${results.totalTimeouts}`);
      console.log(`📊 Tokens with price data: ${results.tokensWithPriceData}`);
      console.log(`📊 Tokens without price data: ${results.tokensWithoutPriceData}`);
    }
  });
  
  simulation.on('error', (error) => {
    console.error('❌ Simulation error:', error);
    fs.unlinkSync(tempScriptPath);
  });
}

// Main execution
async function main() {
  try {
    const lastWeekData = await extractLastWeekBrookCalls();
    
    if (lastWeekData.length > 0) {
      console.log(`\n✅ Successfully extracted ${lastWeekData.length} Brook calls from the last week`);
      console.log(`📁 Data saved to: ${OUTPUT_CSV_PATH}`);
      
      // Run backtest simulation
      await runBacktestSimulation();
    } else {
      console.log('⚠️ No data found for the last week');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { extractLastWeekBrookCalls, filterLastWeek };
