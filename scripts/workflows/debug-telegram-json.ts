#!/usr/bin/env ts-node

/**
 * Debug script for Telegram JSON ingestion
 *
 * Shows parsed and extracted messages before database insertion
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register scripts/workflows/debug-telegram-json.ts --file <path> [--limit <n>]
 */

// Register tsconfig paths for workspace package resolution
import 'tsconfig-paths/register';

import { program } from 'commander';
// Import directly from source to avoid module resolution issues
import { parseJsonExport } from '../../packages/ingestion/src/telegram/TelegramJsonExportParser';
import { normalizedToParsedBatch } from '../../packages/ingestion/src/telegram/normalizedToParsedConverter';
import { MessageIndex } from '../../packages/ingestion/src/MessageIndex';
import { BotMessageExtractor } from '../../packages/ingestion/src/BotMessageExtractor';
import { CallerResolver } from '../../packages/ingestion/src/CallerResolver';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Debug a Telegram JSON export file
 */
async function debugFile(
  filePath: string,
  options: {
    chatId?: string;
    limit?: number;
  }
): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`\n📄 Debugging: ${path.basename(filePath)}`);
  console.log('='.repeat(80));

  // 1. Parse and normalize
  const parseResult = parseJsonExport(filePath, options.chatId);
  console.log(`\n📊 Normalization Results:`);
  console.log(`   Total processed: ${parseResult.totalProcessed}`);
  console.log(`   Normalized: ${parseResult.normalized.length}`);
  console.log(`   Quarantined: ${parseResult.quarantined.length}`);

  if (parseResult.quarantined.length > 0) {
    console.log(`\n⚠️  Quarantined messages (first 5):`);
    parseResult.quarantined.slice(0, 5).forEach((q, i) => {
      console.log(`   ${i + 1}. ${q.error.code}: ${q.error.message}`);
    });
  }

  // 2. Show normalized messages
  const limit = options.limit || 20;
  const messagesToShow = parseResult.normalized.slice(0, limit);

  console.log(`\n📝 First ${messagesToShow.length} Normalized Messages:`);
  console.log('='.repeat(80));
  messagesToShow.forEach((msg, i) => {
    console.log(`\n[${i + 1}] Message ID: ${msg.messageId}`);
    console.log(`   Chat ID: ${msg.chatId}`);
    console.log(`   Type: ${msg.type}${msg.isService ? ' (service)' : ''}`);
    console.log(`   Timestamp: ${new Date(msg.timestampMs).toISOString()}`);
    console.log(`   From: ${msg.fromName || '(anonymous)'}${msg.fromId ? ` (${msg.fromId})` : ''}`);
    console.log(`   Text: ${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}`);
    if (msg.links.length > 0) {
      console.log(`   Links: ${msg.links.map((l) => l.href).join(', ')}`);
    }
    if (msg.replyToMessageId) {
      console.log(`   Reply to: ${msg.replyToMessageId}`);
    }
    console.log(`   Raw keys: ${Object.keys(msg.raw as any).join(', ')}`);
  });

  // 3. Convert to ParsedMessage format
  const parsedMessages = normalizedToParsedBatch(parseResult.normalized);
  console.log(`\n\n🔄 Converted ${parsedMessages.length} messages to ParsedMessage format`);

  // 4. Build message index
  const messageIndex = new MessageIndex();
  const fileName = path.basename(filePath);
  messageIndex.addMessages(fileName, parsedMessages);

  // 5. Find bot messages
  function isBot(from?: string): boolean {
    if (!from) return false;
    const lower = from.toLowerCase();
    return lower === 'rick' || lower === 'phanes' || lower.includes('bot');
  }

  const botMessages = parsedMessages.filter((msg) => isBot(msg.from));
  console.log(`\n🤖 Found ${botMessages.length} bot messages`);

  // 6. Extract from bot messages
  const botExtractor = new BotMessageExtractor();
  const callerResolver = new CallerResolver(messageIndex);

  console.log(
    `\n\n🔍 Extraction Results (first ${Math.min(limit, botMessages.length)} bot messages):`
  );
  console.log('='.repeat(80));

  const botMessagesToShow = botMessages.slice(0, limit);
  for (let i = 0; i < botMessagesToShow.length; i++) {
    const botMessage = botMessagesToShow[i];
    if (!botMessage) continue;

    console.log(`\n[${i + 1}] Bot Message ID: ${botMessage.messageId}`);
    console.log(`   Timestamp: ${botMessage.timestamp.toISOString()}`);
    console.log(`   From: ${botMessage.from}`);

    // Extract bot data
    // First, get the original normalized message to access links
    const normalizedMsg = parseResult.normalized.find(
      (m) => String(m.messageId) === botMessage.messageId
    );

    // Try to extract address from links if available
    let extractedAddress = '';
    if (normalizedMsg?.links) {
      // Look for pump.fun, dexscreener, or solscan links
      for (const link of normalizedMsg.links) {
        // pump.fun links: https://pump.fun/ADDRESS
        const pumpMatch = link.href.match(/pump\.fun\/([A-Za-z0-9]{32,44})/);
        if (pumpMatch) {
          extractedAddress = pumpMatch[1];
          break;
        }
        // dexscreener links: https://dexscreener.com/solana/ADDRESS
        const dexMatch = link.href.match(/dexscreener\.com\/[^\/]+\/([A-Za-z0-9]{32,44})/);
        if (dexMatch) {
          extractedAddress = dexMatch[1];
          break;
        }
        // solscan links: https://solscan.io/token/ADDRESS
        const solscanMatch = link.href.match(/solscan\.io\/token\/([A-Za-z0-9]{32,44})/);
        if (solscanMatch) {
          extractedAddress = solscanMatch[1];
          break;
        }
      }
    }

    const botData = botExtractor.extract(botMessage.text);
    console.log(`\n   📦 Extracted Bot Data:`);
    console.log(`      Contract Address (from extractor): ${botData.contractAddress || '(none)'}`);
    if (extractedAddress && !botData.contractAddress) {
      console.log(`      Contract Address (from links): ${extractedAddress}`);
      botData.contractAddress = extractedAddress; // Use extracted address
    }
    console.log(`      Chain: ${botData.chain}`);
    console.log(`      Token Name: ${botData.tokenName || '(none)'}`);
    console.log(`      Ticker: ${botData.ticker || '(none)'}`);
    console.log(`      Price: ${botData.price || '(none)'}`);
    console.log(`      Market Cap: ${botData.marketCap || '(none)'}`);
    console.log(`      Liquidity: ${botData.liquidity || '(none)'}`);
    console.log(`      Volume: ${botData.volume || '(none)'}`);

    // Resolve caller
    const resolvedCaller = callerResolver.resolveCaller(botMessage, fileName);
    console.log(`\n   👤 Resolved Caller:`);
    if (resolvedCaller) {
      console.log(`      Caller Name: ${resolvedCaller.callerName || '(none)'}`);
      console.log(`      Alert Timestamp: ${resolvedCaller.alertTimestamp.toISOString()}`);
      if (resolvedCaller.callerMessage) {
        console.log(
          `      Caller Message ID: ${resolvedCaller.callerMessage.messageId || '(none)'}`
        );
        console.log(
          `      Caller Text: ${resolvedCaller.callerMessage.text?.substring(0, 100) || '(none)'}${resolvedCaller.callerMessage.text && resolvedCaller.callerMessage.text.length > 100 ? '...' : ''}`
        );
      }
    } else {
      console.log(`      (No caller found)`);
    }

    console.log(`\n   📄 Original Bot Message Text (first 200 chars):`);
    console.log(
      `      ${botMessage.text.substring(0, 200)}${botMessage.text.length > 200 ? '...' : ''}`
    );

    console.log('\n' + '-'.repeat(80));
  }

  // Summary
  console.log(`\n\n📊 Summary:`);
  console.log('='.repeat(80));
  console.log(`Total messages: ${parseResult.totalProcessed}`);
  console.log(`Normalized: ${parseResult.normalized.length}`);
  console.log(`Quarantined: ${parseResult.quarantined.length}`);
  console.log(`Bot messages: ${botMessages.length}`);
  console.log(
    `Bot messages with contract address: ${
      botMessages.filter((msg) => {
        const data = botExtractor.extract(msg.text);
        return !!data.contractAddress;
      }).length
    }`
  );
  console.log(
    `Bot messages with resolved caller: ${
      botMessages.filter((msg) => {
        const resolved = callerResolver.resolveCaller(msg, fileName);
        return !!resolved;
      }).length
    }`
  );
}

program
  .name('debug-telegram-json')
  .description('Debug Telegram JSON exports - show parsed and extracted messages')
  .requiredOption('--file <path>', 'Path to JSON export file')
  .option('--chat-id <id>', 'Chat ID (optional, will be extracted from export if not provided)')
  .option('--limit <n>', 'Number of messages to show (default: 20)', '20')
  .action(async (options) => {
    try {
      await debugFile(options.file, {
        chatId: options.chatId,
        limit: parseInt(options.limit, 10),
      });
      console.log('\n✅ Debug complete!\n');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Debug failed:', (error as Error).message);
      console.error(error);
      process.exit(1);
    }
  });

program.parse();
