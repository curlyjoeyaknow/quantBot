/**
 * Address validation & extraction
 * ===============================
 *
 * Important: EVM addresses are identical across Ethereum, Base, and BSC.
 * You can validate "EVM-ness" but you cannot infer chain from the address alone.
 *
 * Solana: base58, typically 32–44 chars (public keys), no 0/O/I/l in base58 alphabet.
 */
export declare function isBase58(s: string): boolean;
export declare function isSolanaAddress(s: string): boolean;
export declare function isEvmAddress(s: string): boolean;
/**
 * Extract potential addresses from text (Telegram chat blobs).
 * Returns de-duplicated addresses preserving first-seen order.
 */
export declare function extractAddresses(text: string): {
  solana: string[];
  evm: string[];
};
//# sourceMappingURL=addressValidation.d.ts.map
