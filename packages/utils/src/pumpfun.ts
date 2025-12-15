import { PublicKey } from '@solana/web3.js';

export const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

export function derivePumpfunBondingCurve(mint: string): string | null {
  try {
    const mintKey = new PublicKey(mint);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintKey.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );
    return bondingCurve.toBase58();
  } catch {
    return null;
  }
}
