#!/usr/bin/env tsx

/**
 * Show actual extraction from real Telegram messages with labels
 */

import { parseExport } from '@quantbot/ingestion';
import { extractAddresses } from '@quantbot/ingestion';

// Parse a real file
console.log('Parsing Telegram export file...');
const messages = parseExport('data/messages/messages.html');
console.log(`Parsed ${messages.length} messages`);

// Find a bot message
function isBot(sender: string | undefined): boolean {
  if (!sender) return false;
  const cleanSender = sender.trim();
  if (/^rick$/i.test(cleanSender)) return true;
  if (/^phanes$/i.test(cleanSender)) return true;
  if (/rick/i.test(cleanSender) && cleanSender.length < 20) return true;
  if (/phanes/i.test(cleanSender) && cleanSender.length < 20) return true;
  return false;
}

// Find first bot message with a caller message before it
let botMessage: any = null;
let callerMessage: any = null;

for (let i = 0; i < messages.length; i++) {
  if (isBot(messages[i].from)) {
    // Look back for caller
    for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
      if (!isBot(messages[j].from)) {
        botMessage = messages[i];
        callerMessage = messages[j];
        break;
      }
    }
    if (botMessage) break;
  }
}

if (!botMessage) {
  console.error('No bot message found');
  process.exit(1);
}

console.log('='.repeat(80));
console.log('ACTUAL EXTRACTION FROM REAL TELEGRAM MESSAGE');
console.log('='.repeat(80));
console.log();

console.log('📨 CALLER MESSAGE (the alert):');
console.log('─'.repeat(80));
console.log(`From: ${callerMessage.from || '(unknown)'}`);
console.log(`Time: ${callerMessage.timestamp.toISOString()}`);
console.log(
  `Text: ${callerMessage.text.substring(0, 200)}${callerMessage.text.length > 200 ? '...' : ''}`
);
console.log();

console.log('🤖 BOT RESPONSE (the data we extract from):');
console.log('─'.repeat(80));
console.log(`From: ${botMessage.from}`);
console.log(`Time: ${botMessage.timestamp.toISOString()}`);
console.log(`Text:`);
console.log(botMessage.text);
console.log();

console.log('🔍 EXTRACTED DATA WITH LABELS:');
console.log('─'.repeat(80));

// Extract addresses
const extracted = extractAddresses(botMessage.text);
console.log('DEBUG: Address extraction results:');
console.log(`  Solana addresses found: ${extracted.solana.length}`);
console.log(`  EVM addresses found: ${extracted.evm.length}`);
if (extracted.solana.length > 0) {
  console.log(`  Solana: ${extracted.solana[0]}`);
}
if (extracted.evm.length > 0) {
  console.log(`  EVM: ${extracted.evm[0]}`);
}

// Extract ticker
const tickerMatch = botMessage.text.match(/\$([A-Z0-9]{2,15})\b/);
const ticker = tickerMatch ? tickerMatch[1] : null;

// Extract name
const nameMatch1 = botMessage.text.match(/Token:\s*([^($\[]+?)(?:\s*\(|\s*\$|\s*⋅|$)/i);
const nameMatch2 = botMessage.text.match(/^([A-Z][a-zA-Z0-9\s\-\.']+?)\s*\(/);
const nameMatch3 = botMessage.text.match(
  /(?:🟣|🐶|🟢|🔷|🪙|💊)\s*([A-Z][a-zA-Z0-9\s\-\.']+?)(?:\s*\(|\s*\[|\s*\$)/
);
const name = nameMatch1?.[1]?.trim() || nameMatch2?.[1]?.trim() || nameMatch3?.[1]?.trim() || null;

// Extract price
const priceMatch1 = botMessage.text.match(/USD:\s*\$([0-9,]+\.?[0-9]*)/);
const priceMatch2 = botMessage.text.match(/\$\s*([0-9,]+\.?[0-9]*)/);
const priceStr = priceMatch1?.[1] || priceMatch2?.[1];
const price = priceStr ? parseFloat(priceStr.replace(/,/g, '')) : null;

// Extract market cap
const mcapMatch = botMessage.text.match(/MC[:\s]+([0-9,]+\.?[0-9]*)\s*(K|M|B)?/i);
let marketCap: number | null = null;
if (mcapMatch) {
  let value = parseFloat(mcapMatch[1].replace(/,/g, ''));
  const unit = mcapMatch[2]?.toUpperCase();
  if (unit === 'K') value *= 1000;
  else if (unit === 'M') value *= 1000000;
  else if (unit === 'B') value *= 1000000000;
  marketCap = value;
}

// Detect chain
let chain: string | null = null;
if (extracted.solana.length > 0) {
  chain = 'solana';
} else if (extracted.evm.length > 0) {
  const chainText = botMessage.text.toLowerCase();
  if (chainText.includes('ethereum') || chainText.includes('eth')) chain = 'ethereum';
  else if (chainText.includes('base')) chain = 'base';
  else if (chainText.includes('bsc')) chain = 'bsc';
  else chain = 'ethereum'; // default for EVM
}

console.log();
console.log('📍 CA ADDRESS (Contract Address):');
console.log(`   ${extracted.solana[0] || extracted.evm[0] || '(not found)'}`);
console.log('   └─ Used to identify the token on-chain');

console.log();
console.log('⛓️  CHAIN:');
console.log(`   ${chain || '(not detected)'}`);
console.log('   └─ Blockchain network (solana, ethereum, base, bsc)');

console.log();
console.log('🏷️  TICKER (Symbol):');
console.log(`   ${ticker || '(not found)'}`);
console.log('   └─ Token symbol extracted from $SYMBOL pattern');

console.log();
console.log('📛 NAME:');
console.log(`   ${name || '(not found)'}`);
console.log('   └─ Full token name extracted from message');

console.log();
console.log('💰 PRICE:');
console.log(`   $${price?.toLocaleString() || '(not found)'}`);
console.log('   └─ Token price in USD at alert time');

console.log();
console.log('📊 MARKET CAP:');
console.log(`   $${marketCap?.toLocaleString() || '(not found)'}`);
console.log('   └─ Total market capitalization (with K/M/B multiplier)');

console.log();
console.log('✅ EXTRACTION STATUS:');
const hasAll = (extracted.solana[0] || extracted.evm[0]) && ticker && price;
console.log(`   ${hasAll ? '✅ Complete' : '⚠️  Incomplete'}`);
console.log(`   └─ Ready for ingestion: ${hasAll ? 'YES' : 'NO'}`);

console.log();
console.log('='.repeat(80));
