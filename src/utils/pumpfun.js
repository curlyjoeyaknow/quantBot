"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUMP_FUN_PROGRAM_ID = void 0;
exports.derivePumpfunBondingCurve = derivePumpfunBondingCurve;
const web3_js_1 = require("@solana/web3.js");
exports.PUMP_FUN_PROGRAM_ID = new web3_js_1.PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
function derivePumpfunBondingCurve(mint) {
    try {
        const mintKey = new web3_js_1.PublicKey(mint);
        const [bondingCurve] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mintKey.toBuffer()], exports.PUMP_FUN_PROGRAM_ID);
        return bondingCurve.toBase58();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=pumpfun.js.map