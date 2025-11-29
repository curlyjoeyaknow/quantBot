#!/usr/bin/env ts-node
/**
 * Extract Token Addresses from Bot Responses and Update ClickHouse
 * 
 * For tokens without price data:
 * 1. Searches original message files
 * 2. Extracts token addresses from bot responses
 * 3. Fetches metadata, initial price, and market cap
 * 4. Updates ClickHouse with complete token information
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { getClickHouseClient, initClickHouse } from '../src/storage/clickhouse-client';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || 'dec8084b90724ffe949b68d0a18359d6';
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const MESSAGES_DIR = path.join(__dirname, '../data/raw/messages');
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

interface BotResponseMetadata {
  tokenAddress: string;
  name?: string;
  symbol?: string;
  price?: number;
  marketCap?: number;
  volume?: number;
  liquidity?: number;
}

interface MessageContext {
  originalMessage: string;
  sender: string;
  timestamp: string;
  surroundingMessages: Array<{
    sender: string;
    text: string;
    timestamp: string;
    isBot: boolean;
  }>;
  hasJS: boolean;
  botResponses: Array<{
    sender: string;
    text: string;
    tokenAddresses: string[];
    metadata?: BotResponseMetadata[];
  }>;
}

interface TokenMetadata {
  tokenAddress: string;
  chain: string;
  name: string;
  symbol: string;
  initialPrice: number;
  initialMarketCap: number;
  callTimestamp: number;
  sourceFile: string;
  channel: string;
  originalAddress?: string; // The address that was originally extracted (may be wrong)
}

/**
 * Bot detection patterns
 */
function isBot(senderName: string): boolean {
  if (!senderName) return true;
  
  const senderLower = senderName.toLowerCase().trim();
  
  const botPatterns = [
    /bot$/i,
    /gold$/i,
    /burp/i,
    /phanes/i,
    /rick/i,
    /spydefi/i,
    /pirbview/i,
  ];
  
  return botPatterns.some(pattern => pattern.test(senderLower));
}

/**
 * Extract token addresses from text (Solana and EVM)
 * Only extract FULL, valid addresses (32-44 chars for Solana)
 */
function extractTokenAddresses(text: string): string[] {
  const addresses: string[] = [];
  
  // Remove HTML tags and entities first
  let cleanText = text.replace(/<[^>]+>/g, ' ');
  cleanText = cleanText.replace(/&apos;/g, "'");
  cleanText = cleanText.replace(/&quot;/g, '"');
  cleanText = cleanText.replace(/&amp;/g, '&');
  
  // Solana: base58, STRICT 32-44 chars (full addresses only)
  // Solana addresses are typically 32-44 characters in base58
  const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const solanaMatches = cleanText.match(solanaRegex) || [];
  
  // Filter to valid Solana addresses (must be 32-44 chars, no partials)
  const validSolana = solanaMatches.filter(addr => {
    const len = addr.length;
    // Only accept full addresses (32-44 chars)
    // Reject if it looks like a partial (starts with common prefixes that indicate truncation)
    if (len < 32 || len > 44) return false;
    // Reject if it starts with "DEF" (often a prefix from Rick bot formatting)
    if (addr.toUpperCase().startsWith('DEF')) return false;
    return true;
  });
  addresses.push(...validSolana);
  
  // EVM: 0x followed by exactly 40 hex chars (full addresses only)
  const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
  const evmMatches = cleanText.match(evmRegex) || [];
  addresses.push(...evmMatches);
  
  // Look for addresses in code blocks (common in bot messages)
  const codeBlockRegex = /`([1-9A-HJ-NP-Za-km-z]{32,44})`/g;
  const codeMatches = cleanText.match(codeBlockRegex) || [];
  codeMatches.forEach(match => {
    const addr = match.replace(/`/g, '').trim();
    if (addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
      if (!addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  });
  
  // Look for addresses after common prefixes (Phanes bot format: "├ ADDRESS└")
  const phanesFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*└/g;
  const phanesMatches = cleanText.matchAll(phanesFormatRegex);
  for (const match of phanesMatches) {
    const addr = match[1];
    if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
      if (!addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  }
  
  // Look for addresses after "├" (Phanes bot often uses this format)
  const pipeFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})/g;
  const pipeMatches = cleanText.matchAll(pipeFormatRegex);
  for (const match of pipeMatches) {
    const addr = match[1];
    if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
      if (!addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  }
  
  // Remove duplicates and return (preserve case for Solana, lowercase for EVM)
  const unique = new Set<string>();
  addresses.forEach(addr => {
    if (addr.startsWith('0x')) {
      unique.add(addr.toLowerCase());
    } else {
      unique.add(addr); // Keep original case for Solana
    }
  });
  
  return Array.from(unique);
}

/**
 * Extract metadata from bot message text
 * Bots post: Token Name ($SYMBOL) with price, market cap, etc.
 */
function extractMetadataFromBotMessage(text: string, tokenAddress: string): BotResponseMetadata | null {
  const metadata: BotResponseMetadata = { tokenAddress };
  
  // Phanes bot format: "🟣 Token Name ($SYMBOL) ├ ADDRESS└ #SOL (Raydium) | ... USD: $0.0001 ... MC: $100K ..."
  // Rick bot format: "🐶 Token Name [100K/10%] $SYMBOL ... USD: $0.0001 ... FDV: $100K ..."
  
  // Extract symbol from ($SYMBOL) or $SYMBOL
  const symbolMatch = text.match(/\$([A-Z0-9]+)/);
  if (symbolMatch) {
    metadata.symbol = symbolMatch[1];
  }
  
  // Extract name - look for pattern like "Token Name ($SYMBOL)" or "Token Name ["
  const nameMatch = text.match(/(?:🟣|🐶|🟢|🔷)\s*([^($\[]+?)(?:\s*\(|\s*\[|\s*\$)/);
  if (nameMatch) {
    metadata.name = nameMatch[1].trim();
  }
  
  // Extract price - look for "USD: $0.0001" or "$0.0₄5872" (Phanes format with subscript)
  const priceMatch = text.match(/USD:\s*\$?([0-9.,]+(?:₀|₁|₂|₃|₄|₅|₆|₇|₈|₉)?[0-9]*)/);
  if (priceMatch) {
    // Handle subscript notation (e.g., 0.0₄5872 = 0.00005872)
    let priceStr = priceMatch[1].replace(/₀/g, '0').replace(/₁/g, '1').replace(/₂/g, '2')
      .replace(/₃/g, '3').replace(/₄/g, '4').replace(/₅/g, '5').replace(/₆/g, '6')
      .replace(/₇/g, '7').replace(/₈/g, '8').replace(/₉/g, '9');
    priceStr = priceStr.replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (!isNaN(price) && price > 0) {
      metadata.price = price;
    }
  }
  
  // Extract market cap - look for "MC: $100K" or "FDV: $100K" or "[100K/"
  const mcMatch = text.match(/(?:MC|FDV):\s*\$?([0-9.,]+[KM]?)/i) || text.match(/\[([0-9.,]+[KM]?)\//);
  if (mcMatch) {
    let mcStr = mcMatch[1].replace(/,/g, '');
    let multiplier = 1;
    if (mcStr.endsWith('K') || mcStr.endsWith('k')) {
      multiplier = 1000;
      mcStr = mcStr.slice(0, -1);
    } else if (mcStr.endsWith('M') || mcStr.endsWith('m')) {
      multiplier = 1000000;
      mcStr = mcStr.slice(0, -1);
    } else if (mcStr.endsWith('B') || mcStr.endsWith('b')) {
      multiplier = 1000000000;
      mcStr = mcStr.slice(0, -1);
    }
    const mc = parseFloat(mcStr) * multiplier;
    if (!isNaN(mc) && mc > 0) {
      metadata.marketCap = mc;
    }
  }
  
  // Extract volume - look for "Vol: $100K"
  const volMatch = text.match(/Vol:\s*\$?([0-9.,]+[KM]?)/i);
  if (volMatch) {
    let volStr = volMatch[1].replace(/,/g, '');
    let multiplier = 1;
    if (volStr.endsWith('K') || volStr.endsWith('k')) {
      multiplier = 1000;
      volStr = volStr.slice(0, -1);
    } else if (volStr.endsWith('M') || volStr.endsWith('m')) {
      multiplier = 1000000;
      volStr = volStr.slice(0, -1);
    }
    const vol = parseFloat(volStr) * multiplier;
    if (!isNaN(vol) && vol > 0) {
      metadata.volume = vol;
    }
  }
  
  // Extract liquidity - look for "LP: $100K" or "Liq: $100K"
  const liqMatch = text.match(/(?:LP|Liq):\s*\$?([0-9.,]+[KM]?)/i);
  if (liqMatch) {
    let liqStr = liqMatch[1].replace(/,/g, '');
    let multiplier = 1;
    if (liqStr.endsWith('K') || liqStr.endsWith('k')) {
      multiplier = 1000;
      liqStr = liqStr.slice(0, -1);
    } else if (liqStr.endsWith('M') || liqStr.endsWith('m')) {
      multiplier = 1000000;
      liqStr = liqStr.slice(0, -1);
    }
    const liq = parseFloat(liqStr) * multiplier;
    if (!isNaN(liq) && liq > 0) {
      metadata.liquidity = liq;
    }
  }
  
  // Return metadata if we have at least token address and some data
  if (metadata.tokenAddress && (metadata.symbol || metadata.name || metadata.price)) {
    return metadata;
  }
  
  return null;
}

/**
 * Search message file for token address and extract context
 */
function searchMessageFileForToken(
  tokenAddress: string,
  sourceFile: string | undefined,
  channel: string | undefined
): MessageContext | null {
  if (!sourceFile) {
    return null;
  }
  
  // Determine file path based on channel
  let filePath: string;
  if (channel && ['brook', 'brook2', 'brook3', 'brook4', 'brook5'].includes(channel)) {
    filePath = path.join(MESSAGES_DIR, channel, sourceFile);
  } else {
    filePath = path.join(MESSAGES_DIR, sourceFile);
  }
  
  // Try alternative locations if file not found
  if (!fs.existsSync(filePath)) {
    if (channel) {
      const altPath = path.join(MESSAGES_DIR, channel, sourceFile);
      if (fs.existsSync(altPath)) {
        filePath = altPath;
      } else {
        const rootPath = path.join(MESSAGES_DIR, sourceFile);
        if (fs.existsSync(rootPath)) {
          filePath = rootPath;
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }
  
  try {
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse HTML to find messages
    const messageRegex = /<div class="message[^"]*"[^>]*id="message[^"]*">([\s\S]*?)(?=<div class="message|$)/g;
    const messages: Array<{
      html: string;
      sender: string;
      text: string;
      timestamp: string;
      index: number;
    }> = [];
    
    let match;
    let index = 0;
    while ((match = messageRegex.exec(htmlContent)) !== null) {
      const messageHtml = match[1];
      
      // Extract sender
      const senderMatch = messageHtml.match(/<div class="from_name">\s*([^<]+)\s*<\/div>/);
      const sender = senderMatch ? senderMatch[1].trim() : '';
      
      // Extract timestamp
      const timestampMatch = messageHtml.match(/title="([^"]+)"/);
      const timestamp = timestampMatch ? timestampMatch[1] : '';
      
      // Extract text
      const textMatch = messageHtml.match(/<div class="text">([\s\S]*?)<\/div>/);
      const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      
      messages.push({
        html: messageHtml,
        sender,
        text,
        timestamp,
        index,
      });
      
      index++;
    }
    
    // Find message containing the token address
    const tokenLower = tokenAddress.toLowerCase();
    let targetMessageIndex = -1;
    
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].text.toLowerCase().includes(tokenLower)) {
        targetMessageIndex = i;
        break;
      }
    }
    
    if (targetMessageIndex === -1) {
      return null;
    }
    
    const targetMessage = messages[targetMessageIndex];
    
    // Extract surrounding messages (5 before, 10 after)
    const startIndex = Math.max(0, targetMessageIndex - 5);
    const endIndex = Math.min(messages.length, targetMessageIndex + 11);
    const surroundingMessages = messages.slice(startIndex, endIndex).map(msg => ({
      sender: msg.sender,
      text: msg.text,
      timestamp: msg.timestamp,
      isBot: isBot(msg.sender),
    }));
    
    // Check for "JS" mentions in original message
    const hasJS = /\bJS\b/i.test(targetMessage.text) || /\bjavascript\b/i.test(targetMessage.text);
    
    // Find bot responses (messages from bots after the target message)
    // Look further ahead (up to 30 messages) to catch all bot responses
    const botResponses: Array<{
      sender: string;
      text: string;
      tokenAddresses: string[];
      timestamp: string;
      metadata?: BotResponseMetadata[];
    }> = [];
    
    for (let i = targetMessageIndex + 1; i < Math.min(messages.length, targetMessageIndex + 31); i++) {
      const msg = messages[i];
      if (isBot(msg.sender)) {
        const addresses = extractTokenAddresses(msg.text);
        
        // Extract metadata for each address found in this bot message
        const metadataList: BotResponseMetadata[] = [];
        for (const addr of addresses) {
          const metadata = extractMetadataFromBotMessage(msg.text, addr);
          if (metadata) {
            metadataList.push(metadata);
          }
        }
        
        // Include ALL bot messages, even if no addresses found (they might have metadata in other format)
        botResponses.push({
          sender: msg.sender,
          text: msg.text,
          tokenAddresses: addresses,
          timestamp: msg.timestamp,
          metadata: metadataList.length > 0 ? metadataList : undefined,
        });
      }
    }
    
    return {
      originalMessage: targetMessage.text,
      sender: targetMessage.sender,
      timestamp: targetMessage.timestamp,
      surroundingMessages,
      hasJS,
      botResponses,
    };
  } catch (error) {
    console.error(`Error searching message file ${filePath}:`, error);
    return null;
  }
}

/**
 * Fetch token metadata from Birdeye
 */
async function fetchTokenMetadata(tokenAddress: string, chain: string = 'solana'): Promise<{ name: string; symbol: string; price?: number; marketCap?: number } | null> {
  if (!BIRDEYE_API_KEY) {
    console.log(`      ⚠️  No Birdeye API key`);
    return null;
  }
  
  try {
    const response = await axios.get(
      'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain,
        },
        params: {
          address: tokenAddress,
        },
        timeout: 10000,
        validateStatus: (status) => status < 500, // Don't throw on 4xx
      }
    );
    
    if (response.status === 200 && response.data?.success && response.data?.data) {
      const data = response.data.data;
      return {
        name: data.name || `Token ${tokenAddress.substring(0, 8)}`,
        symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        price: data.price,
        marketCap: data.marketCap,
      };
    } else if (response.status === 404 || (response.data && !response.data.success)) {
      console.log(`      ⚠️  Token not found on Birdeye (${response.status})`);
    } else {
      console.log(`      ⚠️  Birdeye API error: ${response.status} - ${JSON.stringify(response.data).substring(0, 100)}`);
    }
  } catch (error: any) {
    if (error.response) {
      console.log(`      ⚠️  API error: ${error.response.status} - ${error.response.statusText}`);
    } else if (error.message) {
      console.log(`      ⚠️  Request error: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Fetch historical price at a specific timestamp
 */
async function fetchHistoricalPrice(tokenAddress: string, timestamp: DateTime, chain: string = 'solana'): Promise<{ price: number; marketCap: number } | null> {
  if (!BIRDEYE_API_KEY) {
    return null;
  }
  
  const unixTimestamp = Math.floor(timestamp.toSeconds());
  const timeWindow = 3600; // 1 hour window
  
  try {
    // Try history_price endpoint first
    const historyResponse = await axios.get('https://public-api.birdeye.so/defi/history_price', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain,
      },
      params: {
        address: tokenAddress,
        address_type: 'token',
        type: '1m',
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        ui_amount_mode: 'raw',
      },
      timeout: 10000,
    });
    
    if (historyResponse.data?.success && historyResponse.data?.data?.items) {
      const items = historyResponse.data.data.items;
      if (items.length > 0) {
        // Find closest price point
        let closestItem = items[0];
        let minDiff = Math.abs(closestItem.unixTime - unixTimestamp);
        
        for (const item of items) {
          const diff = Math.abs(item.unixTime - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestItem = item;
          }
        }
        
        return {
          price: closestItem.value || closestItem.price || 0,
          marketCap: closestItem.marketCap || 0,
        };
      }
    }
    
    // Fallback to OHLCV endpoint
    const ohlcvResponse = await axios.get('https://public-api.birdeye.so/defi/v3/ohlcv', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain,
      },
      params: {
        address: tokenAddress,
        type: '5m',
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        mode: 'range',
        padding: true,
      },
      timeout: 10000,
    });
    
    if (ohlcvResponse.data?.success && ohlcvResponse.data?.data?.items) {
      const candles = ohlcvResponse.data.data.items;
      if (candles.length > 0) {
        let closestCandle = candles[0];
        let minDiff = Math.abs(closestCandle.unix_time - unixTimestamp);
        
        for (const candle of candles) {
          const diff = Math.abs(candle.unix_time - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestCandle = candle;
          }
        }
        
        return {
          price: closestCandle.c || closestCandle.close || 0,
          marketCap: closestCandle.mc || 0,
        };
      }
    }
  } catch (error: any) {
    if (error.response) {
      // API error - token might not exist or API issue
      if (error.response.status === 404) {
        // Token not found - this is expected for some tokens
      } else {
        console.log(`      ⚠️  Price API error: ${error.response.status}`);
      }
    } else if (error.message) {
      console.log(`      ⚠️  Price request error: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Initialize token_metadata table in ClickHouse
 */
async function initTokenMetadataTable(): Promise<void> {
  const ch = getClickHouseClient();
  
  try {
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.token_metadata (
          token_address String,
          chain String,
          name String,
          symbol String,
          initial_price Float64,
          initial_market_cap Float64,
          call_timestamp DateTime,
          source_file String,
          channel String,
          original_address String,
          updated_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY (chain, toYYYYMM(call_timestamp))
        ORDER BY (token_address, chain, call_timestamp)
        SETTINGS index_granularity = 8192
      `,
    });
    
    console.log('✅ Token metadata table initialized');
  } catch (error: any) {
    console.error('❌ Error initializing token metadata table:', error.message);
    throw error;
  }
}

/**
 * Insert or update token metadata in ClickHouse (batch)
 */
async function insertTokenMetadataBatch(metadataList: TokenMetadata[]): Promise<void> {
  if (metadataList.length === 0) return;
  
  const ch = getClickHouseClient();
  
  const rows = metadataList.map(metadata => ({
    token_address: metadata.tokenAddress.toLowerCase(),
    chain: metadata.chain,
    name: metadata.name,
    symbol: metadata.symbol,
    initial_price: metadata.initialPrice,
    initial_market_cap: metadata.initialMarketCap,
    call_timestamp: DateTime.fromSeconds(metadata.callTimestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
    source_file: metadata.sourceFile,
    channel: metadata.channel,
    original_address: metadata.originalAddress?.toLowerCase() || metadata.tokenAddress.toLowerCase(),
    updated_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
  }));
  
  try {
    await ch.insert({
      table: `${CLICKHOUSE_DATABASE}.token_metadata`,
      values: rows,
      format: 'JSONEachRow',
    });
    
    // Verbose output for each token in batch
    console.log(`\n📦 Batch Inserted ${metadataList.length} token(s):`);
    for (const metadata of metadataList) {
      console.log(`   ✅ ${metadata.symbol} (${metadata.name})`);
      console.log(`      Mint: ${metadata.tokenAddress}`);
      console.log(`      Original: ${metadata.originalAddress || metadata.tokenAddress}`);
      console.log(`      Price: $${metadata.initialPrice.toFixed(8)}`);
      console.log(`      Market Cap: $${metadata.initialMarketCap.toLocaleString()}`);
      console.log(`      Source: ${metadata.sourceFile} (${metadata.channel})`);
      console.log(`      Timestamp: ${DateTime.fromSeconds(metadata.callTimestamp).toFormat('yyyy-MM-dd HH:mm:ss')}`);
      console.log('');
    }
  } catch (error: any) {
    console.error(`❌ Error inserting batch of ${metadataList.length} tokens:`, error.message);
    // Log individual tokens that failed
    for (const metadata of metadataList) {
      console.error(`   Failed: ${metadata.tokenAddress} - ${metadata.symbol}`);
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Extracting token addresses from bot responses and updating ClickHouse\n');
  
  // Initialize ClickHouse
  await initClickHouse();
  await initTokenMetadataTable();
  
  // Load calls CSV
  if (!fs.existsSync(CALLS_CSV)) {
    throw new Error(`Calls CSV not found: ${CALLS_CSV}`);
  }
  
  console.log('📂 Loading calls from CSV...');
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  console.log(`   Loaded ${records.length} calls\n`);
  
  // Process each call
  let processed = 0;
  let extracted = 0;
  let updated = 0;
  const metadataBatch: TokenMetadata[] = [];
  const BATCH_SIZE = 10;
  
  for (const record of records) {
    const tokenAddress = (record.tokenAddress || record.token_address || '').toLowerCase();
    const sourceFile = record.sourceFile || record.source_file || '';
    const channel = record.channel || record.Channel || '';
    const timestamp = record.timestamp || record.Timestamp || '';
    
    if (!tokenAddress || !sourceFile || !timestamp) {
      continue;
    }
    
    processed++;
    
    // Parse timestamp
    const callTime = DateTime.fromISO(timestamp);
    if (!callTime.isValid) {
      continue;
    }
    
    // Try to fetch price data first
    const priceData = await fetchHistoricalPrice(tokenAddress, callTime, 'solana');
    
    // If no price data, search message file for bot responses
    if (!priceData || priceData.price === 0) {
      const context = searchMessageFileForToken(tokenAddress, sourceFile, channel);
      
        if (context && context.botResponses.length > 0) {
          console.log(`\n🤖 Found ${context.botResponses.length} bot response(s) for ${tokenAddress.substring(0, 8)}...`);
          
          // Show all bot responses for debugging
          for (const botResponse of context.botResponses) {
            console.log(`   Bot: ${botResponse.sender}`);
            console.log(`   Text: ${botResponse.text.substring(0, 200)}${botResponse.text.length > 200 ? '...' : ''}`);
            if (botResponse.tokenAddresses.length > 0) {
              console.log(`   Addresses found: ${botResponse.tokenAddresses.join(', ')}`);
            }
            if (botResponse.metadata && botResponse.metadata.length > 0) {
              console.log(`   Metadata extracted:`);
              botResponse.metadata.forEach(meta => {
                console.log(`      ${meta.symbol || 'N/A'} (${meta.name || 'N/A'}) - $${meta.price?.toFixed(8) || 'N/A'}, MC: $${meta.marketCap?.toLocaleString() || 'N/A'}`);
              });
            }
          }
          
          // Extract token addresses from bot responses
          const botTokenAddresses: string[] = [];
          for (const botResponse of context.botResponses) {
            botTokenAddresses.push(...botResponse.tokenAddresses);
          }
          
          // Prioritize addresses from FIRST bot response (most likely correct)
          const firstBotAddresses = context.botResponses[0]?.tokenAddresses || [];
          const otherAddresses = botTokenAddresses.filter(addr => !firstBotAddresses.includes(addr));
          
          // Combine: first bot addresses first, then others
          const prioritizedAddresses = [...firstBotAddresses, ...otherAddresses];
          const uniqueAddresses = Array.from(new Set(prioritizedAddresses.map(addr => addr.toLowerCase())));
          
          if (uniqueAddresses.length > 0) {
            extracted++;
            console.log(`\n📝 Extracted ${uniqueAddresses.length} unique token address(es) from bot responses:`);
            uniqueAddresses.forEach((addr, idx) => {
              const isFirstBot = firstBotAddresses.some(a => a.toLowerCase() === addr.toLowerCase());
              console.log(`   ${idx + 1}. ${addr}${isFirstBot ? ' ⭐ (first bot)' : ''}`);
            });
          
          // First, try to use metadata directly from bot messages (most reliable)
          let foundFromBotMessage = false;
          for (const botResponse of context.botResponses) {
            if (botResponse.metadata && botResponse.metadata.length > 0) {
              for (const botMeta of botResponse.metadata) {
                // Skip if same as original
                if (botMeta.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()) {
                  continue;
                }
                
                console.log(`   🔍 Found metadata in bot message for ${botMeta.tokenAddress.substring(0, 16)}...`);
                console.log(`      ${botMeta.symbol || 'N/A'} (${botMeta.name || 'N/A'})`);
                console.log(`      Price: $${botMeta.price?.toFixed(8) || 'N/A'}, Market Cap: $${botMeta.marketCap?.toLocaleString() || 'N/A'}`);
                
                // Use metadata from bot message if we have price
                if (botMeta.price && botMeta.price > 0) {
                  const chain = botMeta.tokenAddress.startsWith('0x') ? 'ethereum' : 'solana';
                  
                  const tokenMetadata: TokenMetadata = {
                    tokenAddress: botMeta.tokenAddress,
                    chain: chain,
                    name: botMeta.name || `Token ${botMeta.tokenAddress.substring(0, 8)}`,
                    symbol: botMeta.symbol || botMeta.tokenAddress.substring(0, 4).toUpperCase(),
                    initialPrice: botMeta.price,
                    initialMarketCap: botMeta.marketCap || 0,
                    callTimestamp: callTime.toSeconds(),
                    sourceFile,
                    channel,
                    originalAddress: tokenAddress,
                  };
                  
                  metadataBatch.push(tokenMetadata);
                  updated++;
                  
                  console.log(`   ✅ Using metadata from bot message: ${botMeta.symbol} (${botMeta.name})`);
                  console.log(`      Mint: ${botMeta.tokenAddress}`);
                  console.log(`      Original (wrong): ${tokenAddress}`);
                  console.log(`      Price: $${botMeta.price.toFixed(8)}`);
                  console.log(`      Market Cap: $${(botMeta.marketCap || 0).toLocaleString()}`);
                  
                  // Insert batch when it reaches BATCH_SIZE
                  if (metadataBatch.length >= BATCH_SIZE) {
                    await insertTokenMetadataBatch(metadataBatch);
                    metadataBatch.length = 0; // Clear array
                  }
                  
                  foundFromBotMessage = true;
                  break;
                }
              }
              if (foundFromBotMessage) break;
            }
          }
          
          // If not found in bot messages, try API calls
          if (!foundFromBotMessage) {
            // Try each address from bot responses (prioritized)
            for (const botTokenAddrLower of uniqueAddresses) {
              // Skip if same as original
              if (botTokenAddrLower.toLowerCase() === tokenAddress.toLowerCase()) {
                console.log(`   ⏭️  Skipping ${botTokenAddrLower.substring(0, 8)}... (same as original)`);
                continue;
              }
              
              // Find original case from bot responses (Solana addresses are case-sensitive!)
              const originalCaseAddr = botTokenAddresses.find(addr => addr.toLowerCase() === botTokenAddrLower.toLowerCase()) || botTokenAddrLower;
              const botTokenAddr = originalCaseAddr; // Use original case
              
              console.log(`   🔍 Trying ${botTokenAddr.substring(0, 16)}... (via API)`);
              
              // Determine chain based on address format
              const chain = botTokenAddr.startsWith('0x') ? 'ethereum' : 'solana';
              
              // Fetch metadata and price (use original case for Solana)
              const metadata = await fetchTokenMetadata(botTokenAddr, chain);
              const botPriceData = await fetchHistoricalPrice(botTokenAddr, callTime, chain);
              
              if (metadata) {
                console.log(`      Metadata: ${metadata.symbol} (${metadata.name})`);
              } else {
                console.log(`      ⚠️  No metadata found`);
              }
              
              if (botPriceData) {
                console.log(`      Price: $${botPriceData.price.toFixed(8)}, Market Cap: $${(botPriceData.marketCap || 0).toLocaleString()}`);
              } else {
                console.log(`      ⚠️  No price data found`);
              }
              
              if (metadata && botPriceData && botPriceData.price > 0) {
                const tokenMetadata: TokenMetadata = {
                  tokenAddress: botTokenAddr,
                  chain: chain,
                  name: metadata.name,
                  symbol: metadata.symbol,
                  initialPrice: botPriceData.price,
                  initialMarketCap: botPriceData.marketCap || 0,
                  callTimestamp: callTime.toSeconds(),
                  sourceFile,
                  channel,
                  originalAddress: tokenAddress,
                };
                
                metadataBatch.push(tokenMetadata);
                updated++;
                
                console.log(`   ✅ Found valid token via API: ${metadata.symbol} (${metadata.name})`);
                console.log(`      Mint: ${botTokenAddr}`);
                console.log(`      Original (wrong): ${tokenAddress}`);
                console.log(`      Price: $${botPriceData.price.toFixed(8)}`);
                console.log(`      Market Cap: $${(botPriceData.marketCap || 0).toLocaleString()}`);
                
                // Insert batch when it reaches BATCH_SIZE
                if (metadataBatch.length >= BATCH_SIZE) {
                  await insertTokenMetadataBatch(metadataBatch);
                  metadataBatch.length = 0; // Clear array
                }
                
                break; // Use first valid address
              }
            }
          }
        }
      }
    }
    
    // Small delay to avoid rate limiting
    if (processed % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Insert any remaining tokens in the batch
  if (metadataBatch.length > 0) {
    console.log(`\n📦 Inserting final batch of ${metadataBatch.length} token(s)...`);
    await insertTokenMetadataBatch(metadataBatch);
  }
  
  console.log(`\n✨ Extraction complete!`);
  console.log(`   Processed: ${processed} calls`);
  console.log(`   Extracted: ${extracted} with bot responses`);
  console.log(`   Updated: ${updated} tokens in ClickHouse`);
}

if (require.main === module) {
  main().catch(console.error);
}

