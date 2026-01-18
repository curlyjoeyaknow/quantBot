#!/usr/bin/env node
/**
 * Generate Telegram Session String
 *
 * ⚠️ IMPORTANT: This authenticates with YOUR PERSONAL Telegram account (not a bot).
 *
 * This script:
 * - Connects to Telegram using your API credentials (from my.telegram.org)
 * - Authenticates using YOUR phone number and verification code
 * - Generates a session string that represents YOUR PERSONAL account
 *
 * The session string is sensitive - anyone with it can access your Telegram account.
 *
 * Usage:
 *   export TELEGRAM_API_ID=12345678
 *   export TELEGRAM_API_HASH=your_api_hash
 *   pnpm tsx scripts/telegram/generate-session.ts
 *
 * The session string will be printed to stdout. Save it securely to TELEGRAM_SESSION.
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || '');
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  if (!apiId || !apiHash) {
    console.error('❌ Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
    console.error('\nGet these from: https://my.telegram.org/apps');
    process.exit(1);
  }

  console.log('🔐 Telegram Session Generator');
  console.log('============================\n');
  console.log('This will authenticate using YOUR PERSONAL Telegram account.');
  console.log("You'll need:");
  console.log('  - Your phone number (with country code, e.g., +1234567890)');
  console.log('  - The verification code Telegram sends you');
  console.log('  - Your 2FA password (if enabled)\n');

  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    console.log('📱 Starting authentication...\n');

    await client.start({
      phoneNumber: async () => await question('Enter your phone number (with country code): '),
      phoneCode: async () => await question('Enter the verification code Telegram sent you: '),
      password: async () =>
        await question('Enter your 2FA password (if enabled, press Enter to skip): '),
      onError: (err) => {
        console.error('\n❌ Login error:', err);
        throw err;
      },
    });

    // Success!
    const sessionString = client.session.save();

    console.log('\n✅ Authentication successful!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SESSION STRING (save this to TELEGRAM_SESSION):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(sessionString);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('💡 Usage:');
    console.log(`  export TELEGRAM_SESSION="${sessionString}"`);
    console.log('  pnpm --filter @quantbot/shadow-runner start\n');

    await client.disconnect();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    if (client.connected) {
      await client.disconnect();
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
