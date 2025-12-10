"use strict";
/**
 * Pump.fun IDL Decoder
 * Decodes Pump.fun bonding curve account data using Anchor's BorshAccountsCoder
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUMP_PROGRAM_ID = void 0;
exports.decodeBondingCurveAccount = decodeBondingCurveAccount;
exports.deriveMintFromBondingCurve = deriveMintFromBondingCurve;
exports.calculatePriceFromBondingCurve = calculatePriceFromBondingCurve;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Pump.fun program ID
exports.PUMP_PROGRAM_ID = new web3_js_1.PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
// Load IDL
const IDL_PATH = path.join(__dirname, '../../examples/solana-defi/PumpFun/Typescript/stream_pump_fun_bonding_curve_progress_accounts/Idl/pump_0.1.0.json');
let accountCoder = null;
function getAccountCoder() {
    if (!accountCoder) {
        try {
            const programIdl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
            accountCoder = new anchor_1.BorshAccountsCoder(programIdl);
        }
        catch (error) {
            // Fallback: try to load from examples directory relative to project root
            const fallbackPath = path.join(process.cwd(), 'examples/solana-defi/PumpFun/Typescript/stream_pump_fun_bonding_curve_progress_accounts/Idl/pump_0.1.0.json');
            try {
                const programIdl = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
                accountCoder = new anchor_1.BorshAccountsCoder(programIdl);
            }
            catch (fallbackError) {
                throw new Error(`Failed to load Pump.fun IDL from ${IDL_PATH} or ${fallbackPath}: ${error}`);
            }
        }
    }
    return accountCoder;
}
/**
 * Decode bonding curve account using Anchor's BorshAccountsCoder
 * @param data - Account data as Buffer, Uint8Array, or base64 string
 * @returns Decoded BondingCurve account or null if invalid
 */
function decodeBondingCurveAccount(data) {
    try {
        const coder = getAccountCoder();
        // Convert input to Buffer
        let buffer;
        if (Buffer.isBuffer(data)) {
            buffer = data;
        }
        else if (data instanceof Uint8Array) {
            buffer = Buffer.from(data);
        }
        else if (typeof data === 'string') {
            // Assume base64
            buffer = Buffer.from(data, 'base64');
        }
        else {
            return null;
        }
        // Check discriminator first
        const expectedDiscriminator = coder.accountDiscriminator('BondingCurve');
        const actualDiscriminator = buffer.slice(0, 8);
        if (!expectedDiscriminator.equals(actualDiscriminator)) {
            return null; // Not a BondingCurve account
        }
        // Decode using Anchor
        const decoded = coder.decode('BondingCurve', buffer);
        if (!decoded) {
            return null;
        }
        // Return decoded account (Anchor handles all the parsing)
        return decoded;
    }
    catch (error) {
        // Silently fail - not a BondingCurve account or invalid data
        return null;
    }
}
/**
 * Derive mint address from bonding curve PDA address
 * Note: This requires a reverse lookup since PDAs can't be reversed directly.
 * We maintain a cache or can fetch from associated token account.
 *
 * @param bondingCurveAddress - The bonding curve PDA address
 * @returns The mint address if found, or null
 */
function deriveMintFromBondingCurve(bondingCurveAddress) {
    // Unfortunately, PDAs can't be reversed directly
    // We need to maintain a mapping or fetch from associated token account
    // For now, return null - caller should maintain their own mapping
    return null;
}
/**
 * Calculate price from decoded bonding curve account
 * Uses the bonding curve formula: price = sol_reserves / token_reserves
 * For Pump.fun: price = real_sol_reserves / real_token_reserves
 */
function calculatePriceFromBondingCurve(account, solPriceUsd = 150) {
    // Get reserves - prefer real_reserves, fallback to virtual_reserves
    const solReserves = account.real_sol_reserves || account.virtual_sol_reserves || account.sol_reserves;
    const tokenReserves = account.real_token_reserves || account.virtual_token_reserves || account.token_reserves;
    if (!solReserves || !tokenReserves) {
        return 0;
    }
    // Convert to string then to number/BigInt
    const solStr = typeof solReserves === 'string' ? solReserves : solReserves.toString();
    const tokenStr = typeof tokenReserves === 'string' ? tokenReserves : tokenReserves.toString();
    // Handle hex strings (from Anchor decoder)
    const solValue = solStr.startsWith('0x') ? BigInt(solStr) : BigInt('0x' + solStr);
    const tokenValue = tokenStr.startsWith('0x') ? BigInt(tokenStr) : BigInt('0x' + tokenStr);
    if (tokenValue === 0n) {
        return 0;
    }
    // Calculate price in SOL per token (using real reserves)
    // Price = sol_reserves / token_reserves
    const priceInSol = Number(solValue) / Number(tokenValue);
    // Convert to USD
    return priceInSol * solPriceUsd;
}
//# sourceMappingURL=pump-idl-decoder.js.map