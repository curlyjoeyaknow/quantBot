/**
 * Golden Path Integration Tests
 *
 * Tests the complete happy path from HTML export to stored data:
 * 1. Parse HTML export
 * 2. Find bot message
 * 3. Extract all metadata
 * 4. Resolve caller message
 * 5. Validate data
 * 6. Store in database
 *
 * Ensures FULL enrichment and CLEAN data
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramCallIngestionService } from '../../src/TelegramCallIngestionService';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { PublicKey } from '@solana/web3.js';

describe('Golden Path Integration Tests', () => {
  let callersRepo: CallersRepository;
  let tokensRepo: TokensRepository;
  let alertsRepo: AlertsRepository;
  let callsRepo: CallsRepository;
  let service: TelegramCallIngestionService;

  beforeEach(() => {
    callersRepo = {
      getOrCreateCaller: vi.fn().mockResolvedValue({
        id: 1,
        handle: 'AnnaGems',
        source: 'telegram',
      }),
    } as any;

    tokensRepo = {
      getOrCreateToken: vi.fn().mockResolvedValue({
        id: 1,
        mint: '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump',
        chain: 'solana',
        name: 'TestToken',
        symbol: 'TEST',
      }),
    } as any;

    alertsRepo = {
      insertAlert: vi.fn().mockResolvedValue(1),
      findByChatAndMessage: vi.fn().mockResolvedValue(null),
    } as any;

    callsRepo = {
      insertCall: vi.fn().mockResolvedValue(1),
    } as any;

    service = new TelegramCallIngestionService(callersRepo, tokensRepo, alertsRepo, callsRepo);
  });

  it('should complete full golden path with all enrichment', async () => {
    const fs = require('fs');
    const path = require('path');
    const testHTML = `
      <html>
        <body>
          <div class="message default clearfix" id="message149468">
            <div class="from_name">AnnaGems️ (multi-chain)</div>
            <div class="text">7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</div>
            <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
          </div>
          <div class="message default clearfix" id="message149470">
            <div class="from_name">Rick</div>
            <div class="reply_to details">
              In reply to <a href="#go_to_message149468">this message</a>
            </div>
            <div class="text">
              <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">🟢</a>
              <a href="https://t.me/RickBurpBot?start=pf_7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">TestToken</a>
              <a href="" onclick="return ShowCashtag(&quot;TEST&quot;)">$TEST</a><br>
              🌐 Solana @ Raydium<br>
              💰 USD: <code>$0.0001553</code><br>
              💎 FDV: <code>$155K</code> ⇨ <code>155K</code> <code>[4s]</code><br>
              💦 Liq: <code>$32.8K</code> <code>[x5]</code><br>
              📊 Vol: <code>$56K</code> ⋅ Age: <code>2y</code><br>
              📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code> 🅑 <code>47</code> Ⓢ <code>18</code><br>
              Total: <code>117</code> ⋅ avg <code>50w</code> old<br>
              🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code><br>
              <code>7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</code>
            </div>
            <div class="pull_right date details" title="10.12.2025 04:37:22 UTC+10:00">04:37</div>
          </div>
        </body>
      </html>
    `;

    const tempFile = path.join(__dirname, 'temp-golden-path-test.html');
    fs.writeFileSync(tempFile, testHTML);

    try {
      const result = await service.ingestExport({
        filePath: tempFile,
        callerName: 'AnnaGems',
        chain: 'solana',
        chatId: 'test-chat',
      });

      // Golden Path Assertions

      // 1. Should find and process bot message
      expect(result.botMessagesFound).toBe(1);
      expect(result.botMessagesProcessed).toBe(1);

      // 2. Should create caller
      expect(callersRepo.getOrCreateCaller).toHaveBeenCalledWith(
        'solana',
        'AnnaGems️ (multi-chain)',
        'AnnaGems️ (multi-chain)'
      );

      // 3. Should create token with FULL address (case-preserved)
      expect(tokensRepo.getOrCreateToken).toHaveBeenCalledWith(
        'solana',
        '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump',
        expect.objectContaining({
          name: 'TestToken',
          symbol: 'TEST',
        })
      );

      // 4. Should validate Solana address is base58
      const tokenCall = (tokensRepo.getOrCreateToken as any).mock.calls[0];
      const mintAddress = tokenCall[1];
      expect(() => new PublicKey(mintAddress)).not.toThrow();
      expect(mintAddress.length).toBeGreaterThanOrEqual(32);
      expect(mintAddress.length).toBeLessThanOrEqual(44);

      // 5. Should insert alert with FULL enrichment
      expect(alertsRepo.insertAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: 1,
          callerId: 1,
          side: 'buy',
          alertPrice: 0.0001553,
          initialMcap: 155000,
          initialPrice: 0.0001553,
          chatId: 'test-chat',
          messageId: '149468',
          messageText: '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump',
          rawPayload: expect.objectContaining({
            botData: expect.objectContaining({
              contractAddress: '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump',
              chain: 'solana',
              tokenName: 'TestToken',
              ticker: 'TEST',
              price: 0.0001553,
              marketCap: 155000,
              liquidity: 32800,
              volume: 56000,
              tokenAge: '2y',
              priceChange1h: 78.7,
              volume1h: 29400,
              buyers1h: 47,
              sellers1h: 18,
              totalHolders: 117,
              freshWallets1d: 3,
              freshWallets7d: 9,
            }),
          }),
        })
      );

      // 6. Should insert call with FULL metadata
      expect(callsRepo.insertCall).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId: 1,
          tokenId: 1,
          callerId: 1,
          side: 'buy',
          signalType: 'entry',
          metadata: expect.objectContaining({
            priceAtAlert: 0.0001553,
            marketCapAtAlert: 155000,
            liquidityAtAlert: 32800,
            volumeAtAlert: 56000,
            tokenAge: '2y',
            priceChange1h: 78.7,
            buyers1h: 47,
            sellers1h: 18,
            totalHolders: 117,
            freshWallets1d: 3,
            freshWallets7d: 9,
          }),
        })
      );

      // 7. Should have inserted exactly one alert and one call
      expect(result.alertsInserted).toBe(1);
      expect(result.callsInserted).toBe(1);
      expect(result.tokensUpserted).toBe(1);
      expect(result.messagesFailed).toBe(0);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should handle Ethereum addresses correctly (not base58)', async () => {
    const fs = require('fs');
    const path = require('path');
    const testHTML = `
      <html>
        <body>
          <div class="message default clearfix" id="message1">
            <div class="from_name">Caller</div>
            <div class="text">0xe6cb52bf0d374236a15290a05ea988d7f643bba4</div>
            <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
          </div>
          <div class="message default clearfix" id="message2">
            <div class="from_name">Rick</div>
            <div class="reply_to details">
              In reply to <a href="#go_to_message1">this message</a>
            </div>
            <div class="text">
              <a href="https://dexscreener.com/ethereum/0xe6cb52bf0d374236a15290a05ea988d7f643bba4">🟢</a>
              💰 USD: <code>$0.0001553</code><br>
            </div>
            <div class="pull_right date details" title="10.12.2025 04:37:22 UTC+10:00">04:37</div>
          </div>
        </body>
      </html>
    `;

    const tempFile = path.join(__dirname, 'temp-ethereum-test.html');
    fs.writeFileSync(tempFile, testHTML);

    (tokensRepo.getOrCreateToken as any).mockResolvedValue({
      id: 1,
      mint: '0xe6cb52bf0d374236a15290a05ea988d7f643bba4',
      chain: 'ethereum',
    });

    try {
      const result = await service.ingestExport({
        filePath: tempFile,
        callerName: 'Caller',
        chain: 'ethereum',
      });

      // Should extract Ethereum address (not base58)
      expect(tokensRepo.getOrCreateToken).toHaveBeenCalled();
      const tokenCall = (tokensRepo.getOrCreateToken as any).mock.calls[0];
      expect(tokenCall).toBeDefined();
      const address = tokenCall[1];
      expect(address).toBe('0xe6cb52bf0d374236a15290a05ea988d7f643bba4');
      expect(address.startsWith('0x')).toBe(true);
      expect(address.length).toBe(42); // 0x + 40 hex chars

      expect(result.alertsInserted).toBe(1);
      expect(result.callsInserted).toBe(1);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
