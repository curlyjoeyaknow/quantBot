"use strict";
/**
 * @quantbot/core
 *
 * Foundational, shared types and interfaces for the QuantBot ecosystem.
 * This package has zero dependencies on other @quantbot packages.
 *
 * All core domain types, simulation types, and configuration types are exported from here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTokenAddress = createTokenAddress;
/**
 * Creates a validated TokenAddress from a string.
 *
 * @param address - The mint address string to validate
 * @returns A branded TokenAddress type
 * @throws Error if address length is invalid (must be 32-44 characters)
 *
 * @example
 * ```typescript
 * const mint = createTokenAddress('So11111111111111111111111111111111111111112');
 * ```
 */
function createTokenAddress(address) {
    if (address.length < 32 || address.length > 44) {
        throw new Error(`Invalid mint address length: ${address.length}. Must be between 32 and 44 characters.`);
    }
    return address;
}
//# sourceMappingURL=index.js.map