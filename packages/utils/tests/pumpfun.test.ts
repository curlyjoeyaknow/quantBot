import { describe, it, expect, beforeAll } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

let derivePumpfunBondingCurve: any;
let PUMP_FUN_PROGRAM_ID: any;

beforeAll(async () => {
  const modulePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/pumpfun.ts'
  );
  const mod = await import(pathToFileURL(modulePath).href);
  derivePumpfunBondingCurve = mod.derivePumpfunBondingCurve;
  PUMP_FUN_PROGRAM_ID = mod.PUMP_FUN_PROGRAM_ID;
});

describe('pumpfun', () => {
  describe('derivePumpfunBondingCurve', () => {
    it('should derive bonding curve address for valid mint', () => {
      // Use a known valid Solana public key
      const mint = 'So11111111111111111111111111111111111111112';
      const result = derivePumpfunBondingCurve(mint);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result?.length).toBeGreaterThan(0);
    });

    it('should return null for invalid mint address', () => {
      const result = derivePumpfunBondingCurve('invalid-address');

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = derivePumpfunBondingCurve('');

      expect(result).toBeNull();
    });

    it('should derive consistent addresses for same mint', () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const result1 = derivePumpfunBondingCurve(mint);
      const result2 = derivePumpfunBondingCurve(mint);

      expect(result1).toBe(result2);
    });

    it('should derive different addresses for different mints', () => {
      const mint1 = 'So11111111111111111111111111111111111111112';
      const mint2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

      const result1 = derivePumpfunBondingCurve(mint1);
      const result2 = derivePumpfunBondingCurve(mint2);

      expect(result1).not.toBe(result2);
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
    });

    it('should use correct program ID', () => {
      expect(PUMP_FUN_PROGRAM_ID.toBase58()).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    });
  });
});
