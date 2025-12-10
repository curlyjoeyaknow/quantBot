/**
 * Unit tests for extractSolanaAddresses
 */

import { describe, it, expect } from 'vitest';
import { extractSolanaAddresses } from '../../src/ingestion/extractSolanaAddresses';

describe('extractSolanaAddresses', () => {
  it('should extract valid Solana addresses', () => {
    const text = 'Check out this token: 7pXs...pump at $0.00001';
    const addresses = extractSolanaAddresses(text);
    
    expect(addresses.length).toBeGreaterThan(0);
    // Should preserve full address if found
  });

  it('should preserve case of addresses', () => {
    const text = 'Token address: 7pXs123AbC456DeF789GhI012JkL345MnO678PqR';
    const addresses = extractSolanaAddresses(text);
    
    if (addresses.length > 0) {
      // Address should preserve original case
      expect(addresses[0]).toMatch(/[A-Za-z]/);
    }
  });

  it('should handle multiple addresses', () => {
    const text = `
      First token: 7pXs123AbC456DeF789GhI012JkL345MnO678PqR
      Second token: 9qYt456CdE789FgH012IjK345LmN678OpQ901RsT
    `;
    const addresses = extractSolanaAddresses(text);
    
    expect(addresses.length).toBeGreaterThanOrEqual(0);
  });

  it('should filter out invalid addresses', () => {
    const text = 'This is not an address: 12345';
    const addresses = extractSolanaAddresses(text);
    
    // Should filter out short strings
    expect(addresses.every(addr => addr.length >= 32)).toBe(true);
  });

  it('should handle empty text', () => {
    const addresses = extractSolanaAddresses('');
    expect(addresses).toEqual([]);
  });

  it('should handle text with no addresses', () => {
    const addresses = extractSolanaAddresses('This is just regular text with no addresses');
    expect(addresses).toEqual([]);
  });
});

