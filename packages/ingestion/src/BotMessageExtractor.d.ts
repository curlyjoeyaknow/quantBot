/**
 * BotMessageExtractor - Extract metadata from Rick/Phanes bot messages
 *
 * Parses HTML from bot responses to extract:
 * - Contract address (case-sensitive)
 * - Chain
 * - Token name, ticker
 * - Price, market cap, liquidity, volume
 * - Token metrics (age, holders, etc.)
 */
import type { Chain } from '@quantbot/core';
export interface ExtractedBotData {
    contractAddress: string;
    chain: Chain;
    tokenName?: string;
    ticker?: string;
    price?: number;
    marketCap?: number;
    liquidity?: number;
    mcToLiquidityRatio?: number;
    volume?: number;
    tokenAge?: string;
    priceChange1h?: number;
    volume1h?: number;
    buyers1h?: number;
    sellers1h?: number;
    topHolders?: number[];
    totalHolders?: number;
    avgHolderAge?: string;
    freshWallets1d?: number;
    freshWallets7d?: number;
    twitterLink?: string;
    telegramLink?: string;
    websiteLink?: string;
    exchange?: string;
    platform?: string;
    athMcap?: number;
    supply?: number;
    thPercent?: number;
    messageTimestamp?: Date;
    originalMessageId?: string;
}
export declare class BotMessageExtractor {
    /**
     * Extract all metadata from bot message (HTML or plain text)
     */
    extract(textOrHtml: string): ExtractedBotData;
    /**
     * Parse number with K/M/B suffix
     */
    private parseNumberWithSuffix;
    /**
     * Normalize chain name from URL or text
     */
    private normalizeChain;
    /**
     * Detect chain from text context (for EVM addresses that can't be distinguished by format)
     * Enhanced with exchange/platform hints and message patterns
     */
    private detectChainFromText;
}
//# sourceMappingURL=BotMessageExtractor.d.ts.map