#!/usr/bin/env ts-node
/**
 * Re-extract CA (Caller Alerts) from Chat Messages with Correct Case from Bot Replies
 *
 * This script:
 * 1. Reads chat message HTML files
 * 2. Uses ChatExtractionEngine to extract tokens from bot replies (which preserve correct case)
 * 3. Updates caller_alerts database with correct case addresses
 * 4. Preserves existing metadata but fixes address case
 *
 * This fixes the issue where addresses were stored in lowercase, but Solana addresses are case-sensitive.
 */
import 'dotenv/config';
//# sourceMappingURL=re-extract-ca-with-case-from-bot-replies.d.ts.map