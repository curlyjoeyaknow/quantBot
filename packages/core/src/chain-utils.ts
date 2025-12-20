/**
 * Chain Utilities
 * 
 * Centralized chain name normalization to ensure consistency across the system.
 */

export type NormalizedChain = 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm';

/**
 * Normalize chain name to lowercase canonical form
 * 
 * Mappings:
 * - SOL, Solana, SOLANA, sol → solana
 * - ETH, Ethereum, ETHEREUM, eth → ethereum
 * - BSC, Bsc, BNB, bnb → bsc
 * - BASE, Base → base
 * - MONAD, Monad → monad
 * - EVM, Evm → evm
 * 
 * @param chain - Chain name (any case, any variant)
 * @returns Normalized chain name (lowercase)
 */
export function normalizeChain(chain: string): NormalizedChain {
  const normalized = chain.toLowerCase().trim();
  
  // Solana variants
  if (normalized === 'sol' || normalized === 'solana') {
    return 'solana';
  }
  
  // Ethereum variants
  if (normalized === 'eth' || normalized === 'ethereum') {
    return 'ethereum';
  }
  
  // BSC variants
  if (normalized === 'bsc' || normalized === 'bnb' || normalized === 'binance') {
    return 'bsc';
  }
  
  // Base variants
  if (normalized === 'base') {
    return 'base';
  }
  
  // Monad variants
  if (normalized === 'monad') {
    return 'monad';
  }
  
  // EVM generic
  if (normalized === 'evm') {
    return 'evm';
  }
  
  // Default to solana for unknown chains
  return 'solana';
}

/**
 * Check if a chain name is already normalized
 */
export function isNormalizedChain(chain: string): chain is NormalizedChain {
  return ['solana', 'ethereum', 'bsc', 'base', 'monad', 'evm'].includes(chain);
}

/**
 * Get display name for a chain (proper case)
 */
export function getChainDisplayName(chain: string): string {
  const normalized = normalizeChain(chain);
  
  const displayNames: Record<NormalizedChain, string> = {
    solana: 'Solana',
    ethereum: 'Ethereum',
    bsc: 'BSC',
    base: 'Base',
    monad: 'Monad',
    evm: 'EVM',
  };
  
  return displayNames[normalized];
}

