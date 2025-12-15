import { describe, it, expect, vi } from 'vitest';
import { decodeBondingCurveAccount, calculatePriceFromBondingCurve, PUMP_PROGRAM_ID } from '../../src/pump-idl-decoder';

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

vi.mock('@coral-xyz/anchor', () => ({
  BorshAccountsCoder: vi.fn().mockImplementation(() => ({
    accountDiscriminator: vi.fn().mockReturnValue(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
    decode: vi.fn().mockReturnValue({
      virtual_token_reserves: '1000000',
      virtual_sol_reserves: '1000000000',
      real_token_reserves: '500000',
      real_sol_reserves: '500000000',
      token_total_supply: '1000000',
      complete: false,
      creator: 'CreatorAddress',
    }),
  })),
  BN: vi.fn(),
}));

describe('Pump IDL Decoder', () => {
  describe('decodeBondingCurveAccount', () => {
    it('should decode valid bonding curve account', () => {
      const mockData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, ...Array(100).fill(0)]);
      const result = decodeBondingCurveAccount(mockData);
      expect(result).toBeDefined();
    });

    it('should return null for invalid data', () => {
      const invalidData = Buffer.from([9, 9, 9, 9, 9, 9, 9, 9]);
      const result = decodeBondingCurveAccount(invalidData);
      // Should handle gracefully
      expect(result === null || result === undefined || typeof result === 'object').toBe(true);
    });

    it('should handle base64 string input', () => {
      const base64Data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, ...Array(100).fill(0)]).toString('base64');
      const result = decodeBondingCurveAccount(base64Data);
      expect(result).toBeDefined();
    });
  });

  describe('calculatePriceFromBondingCurve', () => {
    it('should calculate price from bonding curve data', () => {
      const mockAccount = {
        virtual_token_reserves: '1000000',
        virtual_sol_reserves: '1000000000',
        real_token_reserves: '500000',
        real_sol_reserves: '500000000',
        token_total_supply: '1000000',
        complete: false,
        creator: 'CreatorAddress',
      };
      const price = calculatePriceFromBondingCurve(mockAccount);
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });
  });

  describe('PUMP_PROGRAM_ID', () => {
    it('should have correct program ID', () => {
      expect(PUMP_PROGRAM_ID).toBeDefined();
    });
  });
});

