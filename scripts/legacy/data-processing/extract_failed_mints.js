const fs = require('fs');

/**
 * Extract failed mint addresses from brook simulation results (CSV output from simulation runner)
 * 
 * This script reads a CSV file of mint simulation results, groups all failed entries by error type,
 * reports stats, and exports separate CSV files for failed and successful mints.
 */
function extractFailedMints() {
  console.log('🔍 Extracting failed mint addresses from brook simulation results...\n');
  
  const resultsFile = './brook_simulations/brook_simulation_results_2025-10-25.csv'; // Path to the simulation results
  
  // Read the results CSV as a string
  const csvContent = fs.readFileSync(resultsFile, 'utf8');

  // Split content into lines (first line is the header)
  const lines = csvContent.split('\n');
  const headers = lines[0].split(','); // CSV headers

  // Arrays to store failed/successful mints for processing/report
  const failedMints = [];
  const successfulMints = [];
  
  // Parse each line (skip header row at i=0)
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) { // Ignore empty lines
      const values = lines[i].split(','); // Split CSV columns
      const row = {};
      headers.forEach((header, index) => {
        // Assign value for each header; handles missing columns safely
        row[header.trim()] = values[index]?.trim();
      });
      
      const address = row['Address'];
      const error = row['Error'];
      const tokenName = row['Token Name'];
      
      // If there's an error present, treat as failed token simulation
      if (error && error !== '') {
        failedMints.push({
          address: address,
          chain: row['Chain'],
          error: error,
          sender: row['Sender'],
          timestamp: row['Timestamp']
        });
      }
      // Else, if it looks like a successful simulation (tokenName set and not N/A)
      else if (tokenName && tokenName !== 'N/A') {
        successfulMints.push({
          address: address,
          chain: row['Chain'],
          tokenName: tokenName,
          tokenSymbol: row['Token Symbol']
        });
      }
    }
  }
  
  // Print summary statistics
  console.log(`📊 Summary:`);
  console.log(`   Total entries processed: ${failedMints.length + successfulMints.length}`); // Sum of parsed
  console.log(`   ✅ Successful: ${successfulMints.length}`);
  console.log(`   ❌ Failed: ${failedMints.length}`);
  console.log(`   Success rate: ${(successfulMints.length / (failedMints.length + successfulMints.length) * 100).toFixed(1)}%\n`);
  
  console.log('❌ FAILED MINT ADDRESSES:\n');
  
  // Group failed mints by error reason for easier analysis
  const errorGroups = {};
  failedMints.forEach(mint => {
    // Make a new array for this error if it doesn't exist yet
    if (!errorGroups[mint.error]) {
      errorGroups[mint.error] = [];
    }
    errorGroups[mint.error].push(mint); // Add this mint to error group
  });
  
  // Print failed mints grouped by error type, with counts
  Object.keys(errorGroups).forEach(errorType => {
    console.log(`📋 ${errorType} (${errorGroups[errorType].length} tokens):`);
    errorGroups[errorType].forEach(mint => {
      // For each failed mint, show address, chain, and who called it (sender)
      console.log(`   ${mint.address} (${mint.chain}) - ${mint.sender}`);
    });
    console.log('');
  });
  
  // Prepare failed mints for export as CSV
  const failedCsvContent = [
    'Address,Chain,Error,Sender,Timestamp',
    ...failedMints.map(mint => [
      mint.address,
      mint.chain,
      mint.error,
      mint.sender,
      mint.timestamp
    ].join(','))
  ].join('\n');
  
  // Write failed CSV to disk
  const failedCsvFilename = `failed_mints_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(failedCsvFilename, failedCsvContent);
  console.log(`💾 Failed mints exported to: ${failedCsvFilename}`);
  
  // Prepare successful mints export as CSV
  const successCsvContent = [
    'Address,Chain,Token Name,Token Symbol',
    ...successfulMints.map(mint => [
      mint.address,
      mint.chain,
      mint.tokenName,
      mint.tokenSymbol
    ].join(','))
  ].join('\n');
  
  // Write successful CSV to disk
  const successCsvFilename = `successful_mints_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(successCsvFilename, successCsvContent);
  console.log(`💾 Successful mints exported to: ${successCsvFilename}`);
  
  // Print just addresses for easy copying into other tools/scripts
  console.log('\n📋 FAILED MINT ADDRESSES (for easy copying):\n');
  failedMints.forEach(mint => {
    console.log(mint.address); // Show just the address
  });
}

// Run the extraction function
extractFailedMints();
