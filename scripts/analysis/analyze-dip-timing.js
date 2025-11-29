const fs = require('fs');
const results = JSON.parse(fs.readFileSync('data/exports/brook_dip_entry_results.json', 'utf8'));
const winners = results.filter(r => r.success && r.pnl > 1);

console.log('Looking at dip entry winners to see if they caught the recovery:\n');

winners.slice(0, 5).forEach((r, i) => {
  const entryPct = ((r.entryPrice / r.alertPrice - 1) * 100).toFixed(1);
  const finalPct = ((r.finalPrice / r.entryPrice - 1) * 100).toFixed(1);
  
  console.log(`Winner ${i+1}:`);
  console.log(`  Entered at: -${entryPct}% from alert`);
  console.log(`  Final from entry: ${finalPct}%`);
  console.log(`  Multiplier from alert: ${r.multiplier.toFixed(2)}x`);
  console.log(`  PNL: ${r.pnl.toFixed(2)}x\n`);
});

console.log('\nTHE PROBLEM:');
console.log('Entry happens when price FIRST dips to -30%');
console.log('But the 1200% recovery happens AFTER hitting the -30% stop');
console.log('So dip entry enters TOO EARLY - before the full dump happens');
console.log("Then the recovery happens while you're in a losing position");

