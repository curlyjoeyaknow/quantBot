"use strict";
/**
 * DEX Transaction Parser
 * Parses transactions from Raydium, Orca, Meteora to extract prices and mints
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DexTransactionParser = void 0;
const web3_js_1 = require("@solana/web3.js");
// Transaction formatter (from examples)
class TransactionFormatter {
    formTransactionFromJson(data, time) {
        const rawTx = data['transaction'] || data;
        const slot = data.slot || rawTx.slot;
        const version = rawTx.transaction?.message?.versioned ? 0 : 'legacy';
        const meta = this.formMeta(rawTx.meta || rawTx.transaction?.meta);
        // Handle signatures - could be base64 Buffer or already encoded string
        let signatures = [];
        if (rawTx.transaction?.signatures) {
            signatures = rawTx.transaction.signatures.map((s) => {
                if (typeof s === 'string')
                    return s;
                if (Buffer.isBuffer(s)) {
                    try {
                        const bs58 = require('bs58');
                        return bs58.encode(s);
                    }
                    catch {
                        return s.toString('base64');
                    }
                }
                return String(s);
            });
        }
        const message = this.formTxnMessage(rawTx.transaction?.message || rawTx.message);
        return {
            slot: slot || 0,
            version: version,
            blockTime: time,
            meta,
            transaction: {
                signatures,
                message,
            },
        };
    }
    formTxnMessage(message) {
        // Simplified - full implementation in examples
        return message;
    }
    formMeta(meta) {
        return {
            err: meta.errorInfo ? { err: meta.errorInfo } : null,
            fee: meta.fee,
            preBalances: meta.preBalances,
            postBalances: meta.postBalances,
            preTokenBalances: meta.preTokenBalances || [],
            postTokenBalances: meta.postTokenBalances || [],
            logMessages: meta.logMessages || [],
            loadedAddresses: meta.loadedWritableAddresses || meta.loadedReadonlyAddresses
                ? {
                    writable: meta.loadedWritableAddresses?.map((address) => new web3_js_1.PublicKey(Buffer.from(address, 'base64'))) || [],
                    readonly: meta.loadedReadonlyAddresses?.map((address) => new web3_js_1.PublicKey(Buffer.from(address, 'base64'))) || [],
                }
                : undefined,
            innerInstructions: meta.innerInstructions || [],
        };
    }
}
class DexTransactionParser {
    constructor() {
        // Program IDs
        this.PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
        this.RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
        this.ORCA_WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
        this.METEORA_DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
        this.SOL_MINT = 'So11111111111111111111111111111111111111112';
        this.USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        this.transactionFormatter = new TransactionFormatter();
    }
    /**
     * Parse transaction and extract swap events
     */
    parseTransaction(data) {
        try {
            if (!data.transaction)
                return null;
            const txn = this.transactionFormatter.formTransactionFromJson(data.transaction, Date.now());
            // Check which DEX this transaction belongs to
            const programIds = this.getProgramIds(txn);
            if (programIds.includes(this.PUMP_FUN_PROGRAM_ID)) {
                return this.parsePumpFunTransaction(txn);
            }
            else if (programIds.includes(this.RAYDIUM_AMM_PROGRAM_ID)) {
                return this.parseRaydiumTransaction(txn);
            }
            else if (programIds.includes(this.ORCA_WHIRLPOOL_PROGRAM_ID)) {
                return this.parseOrcaTransaction(txn);
            }
            else if (programIds.includes(this.METEORA_DBC_PROGRAM_ID)) {
                return this.parseMeteoraTransaction(txn);
            }
            return null;
        }
        catch (error) {
            // Silently fail - transaction parsing is best-effort
            return null;
        }
    }
    /**
     * Extract mint from Pump.fun token creation transaction
     */
    extractMintFromPumpFunCreation(data) {
        try {
            if (!data.transaction)
                return null;
            const txn = this.transactionFormatter.formTransactionFromJson(data.transaction, Date.now());
            // Check if this is a Pump.fun transaction
            const programIds = this.getProgramIds(txn);
            if (!programIds.includes(this.PUMP_FUN_PROGRAM_ID))
                return null;
            // Extract mint from post token balances
            if (txn.meta?.postTokenBalances) {
                for (const balance of txn.meta.postTokenBalances) {
                    if (balance.mint && balance.mint !== this.SOL_MINT && balance.mint !== this.USDC_MINT) {
                        return balance.mint;
                    }
                }
            }
            return null;
        }
        catch (error) {
            return null;
        }
    }
    getProgramIds(txn) {
        const programIds = [];
        if (txn.transaction?.message) {
            const accountKeys = txn.transaction.message.getAccountKeys();
            const keys = accountKeys.keySegments().flat();
            for (const key of keys) {
                if (key instanceof web3_js_1.PublicKey) {
                    programIds.push(key.toBase58());
                }
                else if (typeof key === 'string') {
                    programIds.push(key);
                }
            }
        }
        return programIds;
    }
    parsePumpFunTransaction(txn) {
        // Pump.fun swaps are handled via bonding curve account updates
        // This is mainly for token creation events
        return null;
    }
    parseRaydiumTransaction(txn) {
        try {
            // Extract from token balances (simplified approach)
            const preBalances = txn.meta?.preTokenBalances || [];
            const postBalances = txn.meta?.postTokenBalances || [];
            // Find token mint (not SOL/USDC)
            const tokenMint = preBalances.find((b) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT)?.mint;
            if (!tokenMint)
                return null;
            // Find SOL balance changes to determine buy/sell
            const solPre = preBalances.find((b) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const solPost = postBalances.find((b) => b.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const type = solPre > solPost ? 'Buy' : 'Sell';
            // Extract amounts (simplified - full parsing requires IDL)
            const tokenPre = preBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const tokenPost = postBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
            const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
            return {
                type,
                mint: tokenMint,
                amountIn: amountIn.toString(),
                amountOut: amountOut.toString(),
            };
        }
        catch (error) {
            return null;
        }
    }
    parseOrcaTransaction(txn) {
        try {
            // Similar to Raydium - extract from token balances
            const preBalances = txn.meta?.preTokenBalances || [];
            const postBalances = txn.meta?.postTokenBalances || [];
            const tokenMint = preBalances.find((b) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT)?.mint;
            if (!tokenMint)
                return null;
            const solPre = preBalances.find((b) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const solPost = postBalances.find((b) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const type = solPre > solPost ? 'Buy' : 'Sell';
            const tokenPre = preBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const tokenPost = postBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
            const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
            return {
                type,
                mint: tokenMint,
                amountIn: amountIn.toString(),
                amountOut: amountOut.toString(),
            };
        }
        catch (error) {
            return null;
        }
    }
    parseMeteoraTransaction(txn) {
        try {
            // Similar approach for Meteora
            const preBalances = txn.meta?.preTokenBalances || [];
            const postBalances = txn.meta?.postTokenBalances || [];
            const tokenMint = preBalances.find((b) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT)?.mint;
            if (!tokenMint)
                return null;
            const solPre = preBalances.find((b) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const solPost = postBalances.find((b) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
            const type = solPre > solPost ? 'Buy' : 'Sell';
            const tokenPre = preBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const tokenPost = postBalances.find((b) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
            const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
            const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
            return {
                type,
                mint: tokenMint,
                amountIn: amountIn.toString(),
                amountOut: amountOut.toString(),
            };
        }
        catch (error) {
            return null;
        }
    }
}
exports.DexTransactionParser = DexTransactionParser;
//# sourceMappingURL=dex-transaction-parser.js.map