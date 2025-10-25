const fs = require('fs');

/**
 * Extract failed mint addresses from brook simulation results
 */
function extractFailedMints() {
  console.log('🔍 Extracting failed mint addresses from brook simulation results...\n');
  
  const resultsFile = './brook_simulations/brook_simulation_results_2025-10-25.csv';
  
  // Read the results CSV
  const csvContent = fs.readFileSync(resultsFile, 'utf8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');
  
  const failedMints = [];
  const successfulMints = [];
  
  // Parse CSV data
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim();
      });
      
      const address = row['Address'];
      const error = row['Error'];
      const tokenName = row['Token Name'];
      
      if (error && error !== '') {
        // Failed token
        failedMints.push({
          address: address,
          chain: row['Chain'],
          error: error,
          sender: row['Sender'],
          timestamp: row['Timestamp']
        });
      } else if (tokenName && tokenName !== 'N/A') {
        // Successful token
        successfulMints.push({
          address: address,
          chain: row['Chain'],
          tokenName: tokenName,
          tokenSymbol: row['Token Symbol']
        });
      }
    }
  }
  
  console.log(`📊 Summary:`);
  console.log(`   Total entries processed: ${failedMints.length + successfulMints.length}`);
  console.log(`   ✅ Successful: ${successfulMints.length}`);
  console.log(`   ❌ Failed: ${failedMints.length}`);
  console.log(`   Success rate: ${(successfulMints.length / (failedMints.length + successfulMints.length) * 100).toFixed(1)}%\n`);
  
  console.log('❌ FAILED MINT ADDRESSES:\n');
  
  // Group by error type
  const errorGroups = {};
  failedMints.forEach(mint => {
    if (!errorGroups[mint.error]) {
      errorGroups[mint.error] = [];
    }
    errorGroups[mint.error].push(mint);
  });
  
  Object.keys(errorGroups).forEach(errorType => {
    console.log(`📋 ${errorType} (${errorGroups[errorType].length} tokens):`);
    errorGroups[errorType].forEach(mint => {
      console.log(`   ${mint.address} (${mint.chain}) - ${mint.sender}`);
    });
    console.log('');
  });
  
  // Export failed mints to CSV
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
  
  const failedCsvFilename = `failed_mints_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(failedCsvFilename, failedCsvContent);
  console.log(`💾 Failed mints exported to: ${failedCsvFilename}`);
  
  // Export successful mints to CSV
  const successCsvContent = [
    'Address,Chain,Token Name,Token Symbol',
    ...successfulMints.map(mint => [
      mint.address,
      mint.chain,
      mint.tokenName,
      mint.tokenSymbol
    ].join(','))
  ].join('\n');
  
  const successCsvFilename = `successful_mints_${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(successCsvFilename, successCsvContent);
  console.log(`💾 Successful mints exported to: ${successCsvFilename}`);
  
  // Show just the addresses for easy copying
  console.log('\n📋 FAILED MINT ADDRESSES (for easy copying):\n');
  failedMints.forEach(mint => {
    console.log(mint.address);
  });
}

// Run the extraction
extractFailedMints();
