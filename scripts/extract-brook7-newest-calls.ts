#!/usr/bin/env ts-node

/**
 * Extract newest calls from brook7 for all callers
 * - Maintains case sensitivity for mints
 * - Preserves exact timestamp
 * - Deduplicates bot responses (Phanes and Rick) to avoid counting same call twice
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { Database } from 'sqlite3';
import { promisify } from 'util';

const BROOK7_DIR = path.join(process.cwd(), 'data', 'raw', 'messages', 'brook7');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'exports', 'csv');
const DB_PATH = path.join(process.cwd(), 'data', 'caller_alerts.db');

// Bot names to filter out (these are automated responses, not actual calls)
const BOT_NAMES = [
  'Rick',
  'Phanes [Gold]',
  'Phanes',
  'RickBurpBot',
  'PhanesGoldBot',
  'RickSanchez',
  'RickBurp',
  'PhanesBot',
];

interface ExtractedCall {
  caller: string;
  tokenAddress: string;
  timestamp: string; // ISO format
  messageText: string;
  messageId: string;
}

interface ProcessedCall {
  caller: string;
  tokenAddress: string;
  timestamp: string;
  messageText: string;
}

/**
 * Check if sender is a bot
 */
function isBot(sender: string): boolean {
  if (!sender) return true;
  
  const senderLower = sender.toLowerCase().trim();
  
  // Check against known bot names
  for (const botName of BOT_NAMES) {
    if (senderLower.includes(botName.toLowerCase())) {
      return true;
    }
  }
  
  // Additional bot patterns
  const botPatterns = [
    /\[gold\]/i,
    /burp/i,
  ];
  
  return botPatterns.some(pattern => pattern.test(senderLower));
}

/**
 * Parse Telegram timestamp from HTML
 */
function parseTelegramTimestamp(dateStr: string): DateTime | null {
  try {
    // Format: "18.11.2025 01:53:31 UTC+10:00"
    const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-]\d{2}):(\d{2})/);
    
    if (!match) {
      console.warn(`Could not parse date: ${dateStr}`);
      return null;
    }
    
    const [, day, month, year, hour, minute, second, tzHour, tzMinute] = match;
    
    // Build ISO string
    const isoDate = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzHour}:${tzMinute}`;
    const dt = DateTime.fromISO(isoDate, { setZone: true });
    
    if (!dt.isValid) {
      console.warn(`Invalid DateTime: ${isoDate}`);
      return null;
    }
    
    return dt.toUTC();
  } catch (error) {
    console.error('Error parsing timestamp:', error);
    return null;
  }
}

/**
 * Extract Solana addresses from text
 * Solana addresses are base58 encoded, 32-44 characters
 */
function extractSolanaAddresses(text: string): string[] {
  // Solana addresses: base58, typically 32-44 chars, alphanumeric
  const solanaRegex = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
  const matches = text.match(solanaRegex) || [];
  
  // Filter out common false positives
  return matches.filter(addr => {
    // Must not be all same character
    if (new Set(addr).size === 1) return false;
    // Should have some variety in characters
    if (!/[A-Z]/.test(addr) || !/[a-z]/.test(addr)) return false;
    return true;
  });
}

/**
 * Process a single HTML file from brook7
 */
function processMessageFile(filePath: string): ExtractedCall[] {
  console.log(`Processing: ${filePath}`);
  
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);
  const calls: ExtractedCall[] = [];
  
  // Find all messages
  $('.message.default').each((_, element) => {
    const $msg = $(element);
    
    // Extract sender name
    const sender = $msg.find('.from_name').text().trim();
    
    // Skip bots
    if (isBot(sender)) {
      return; // continue
    }
    
    // Extract message text
    const messageText = $msg.find('.text').text().trim();
    
    if (!messageText) return;
    
    // Extract timestamp
    const dateTitle = $msg.find('.date.details').attr('title');
    if (!dateTitle) return;
    
    const timestamp = parseTelegramTimestamp(dateTitle);
    if (!timestamp) return;
    
    // Extract message ID
    const messageId = $msg.attr('id') || '';
    
    // Extract token addresses
    const addresses = extractSolanaAddresses(messageText);
    
    // Create a call for each address found
    for (const address of addresses) {
      calls.push({
        caller: sender,
        tokenAddress: address, // Case preserved!
        timestamp: timestamp.toISO()!,
        messageText: messageText.substring(0, 200), // Limit text length
        messageId: `${path.basename(filePath)}_${messageId}`,
      });
    }
  });
  
  return calls;
}

/**
 * Deduplicate calls
 * - Same token address (case-insensitive comparison for dedup, but preserve original case)
 * - Within 5 minutes of each other
 * - Keep the earliest call
 */
function deduplicateCalls(calls: ExtractedCall[]): ProcessedCall[] {
  // Sort by timestamp
  const sorted = calls.sort((a, b) => {
    const timeA = DateTime.fromISO(a.timestamp);
    const timeB = DateTime.fromISO(b.timestamp);
    return timeA.toMillis() - timeB.toMillis();
  });
  
  const unique: ProcessedCall[] = [];
  const seen = new Map<string, DateTime>(); // lowercase address -> timestamp
  
  for (const call of sorted) {
    const lowerAddress = call.tokenAddress.toLowerCase();
    const callTime = DateTime.fromISO(call.timestamp);
    
    // Check if we've seen this address recently
    const lastSeen = seen.get(lowerAddress);
    
    if (lastSeen) {
      const diffMinutes = callTime.diff(lastSeen, 'minutes').minutes;
      
      // If within 5 minutes, it's a duplicate
      if (diffMinutes < 5) {
        console.log(`Duplicate: ${call.tokenAddress.substring(0, 12)}... by ${call.caller} (${diffMinutes.toFixed(1)}min after first)`);
        continue;
      }
    }
    
    // Not a duplicate, add it
    unique.push({
      caller: call.caller,
      tokenAddress: call.tokenAddress, // Original case preserved
      timestamp: call.timestamp,
      messageText: call.messageText,
    });
    
    seen.set(lowerAddress, callTime);
  }
  
  return unique;
}

/**
 * Get newest calls per caller
 */
function getNewestCallsPerCaller(calls: ProcessedCall[]): Map<string, ProcessedCall[]> {
  const callerCalls = new Map<string, ProcessedCall[]>();
  
  for (const call of calls) {
    if (!callerCalls.has(call.caller)) {
      callerCalls.set(call.caller, []);
    }
    callerCalls.get(call.caller)!.push(call);
  }
  
  // Sort each caller's calls by timestamp descending (newest first)
  for (const [caller, callList] of callerCalls) {
    callList.sort((a, b) => {
      const timeA = DateTime.fromISO(a.timestamp);
      const timeB = DateTime.fromISO(b.timestamp);
      return timeB.toMillis() - timeA.toMillis();
    });
  }
  
  return callerCalls;
}

/**
 * Save to database
 */
async function saveToDatabaseWithCaseSensitivity(calls: ProcessedCall[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new Database(DB_PATH);
    
    db.serialize(() => {
      // Ensure tables exist
      db.run(`
        CREATE TABLE IF NOT EXISTS caller_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          caller_name TEXT NOT NULL,
          token_address TEXT NOT NULL,
          token_symbol TEXT,
          chain TEXT NOT NULL DEFAULT 'solana',
          alert_timestamp DATETIME NOT NULL,
          alert_message TEXT,
          price_at_alert REAL,
          volume_at_alert REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(caller_name, token_address, alert_timestamp)
        )
      `, (err) => {
        if (err) {
          db.close();
          return reject(err);
        }
        
        let inserted = 0;
        let processed = 0;
        
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO caller_alerts 
          (caller_name, token_address, chain, alert_timestamp, alert_message)
          VALUES (?, ?, ?, ?, ?)
        `);
        
        for (const call of calls) {
          stmt.run(
            call.caller,
            call.tokenAddress, // Case preserved
            'solana',
            call.timestamp,
            call.messageText,
            function(this: any, err: Error | null) {
              if (!err && this.changes > 0) {
                inserted++;
              }
            }
          );
        }
        
        stmt.finalize((err) => {
          db.close();
          if (err) {
            reject(err);
          } else {
            console.log(`\nProcessed ${calls.length} calls, inserted ${inserted} new calls into database`);
            resolve();
          }
        });
      });
    });
  });
}

/**
 * Export to CSV
 */
function exportToCSV(calls: ProcessedCall[], filename: string): void {
  const lines = [
    'caller,token_address,timestamp,message_preview'
  ];
  
  for (const call of calls) {
    const escapedMessage = call.messageText.replace(/"/g, '""');
    lines.push(
      `"${call.caller}","${call.tokenAddress}","${call.timestamp}","${escapedMessage}"`
    );
  }
  
  const csvPath = path.join(OUTPUT_DIR, filename);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
  
  console.log(`\nExported to: ${csvPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('=== Brook7 Call Extraction ===\n');
  console.log('Configuration:');
  console.log(`- Brook7 directory: ${BROOK7_DIR}`);
  console.log(`- Output directory: ${OUTPUT_DIR}`);
  console.log(`- Database: ${DB_PATH}`);
  console.log(`- Bot names filtered: ${BOT_NAMES.join(', ')}\n`);
  
  // Find all HTML files in brook7 directory
  const files = fs.readdirSync(BROOK7_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(BROOK7_DIR, f));
  
  console.log(`Found ${files.length} HTML files\n`);
  
  // Extract calls from all files
  let allCalls: ExtractedCall[] = [];
  
  for (const file of files) {
    const fileCalls = processMessageFile(file);
    allCalls = allCalls.concat(fileCalls);
  }
  
  console.log(`\nTotal calls extracted: ${allCalls.length}`);
  
  // Deduplicate
  const uniqueCalls = deduplicateCalls(allCalls);
  console.log(`Unique calls after deduplication: ${uniqueCalls.length}\n`);
  
  // Get calls per caller
  const callerMap = getNewestCallsPerCaller(uniqueCalls);
  
  console.log('=== Calls per Caller ===');
  for (const [caller, calls] of callerMap) {
    console.log(`${caller}: ${calls.length} calls`);
  }
  
  // Save to database
  await saveToDatabaseWithCaseSensitivity(uniqueCalls);
  
  // Export to CSV
  exportToCSV(uniqueCalls, 'brook7_calls_newest.csv');
  
  // Also export per caller
  for (const [caller, calls] of callerMap) {
    const safeName = caller.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    exportToCSV(calls, `brook7_${safeName}_calls.csv`);
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total callers: ${callerMap.size}`);
  console.log(`Total unique calls: ${uniqueCalls.length}`);
  console.log(`Newest call: ${uniqueCalls[0]?.timestamp || 'N/A'}`);
  console.log(`Oldest call: ${uniqueCalls[uniqueCalls.length - 1]?.timestamp || 'N/A'}`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

