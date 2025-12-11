/**
 * Unified Chat Extraction Engine
 *
 * Single source of truth for extracting token addresses and metadata from chat messages.
 *
 * Features:
 * - Extracts from original message AND bot responses (next 2 bot messages)
 * - Handles case sensitivity issues
 * - Handles missing letters/stray characters
 * - Multiple fallback methods for address validation
 * - Extracts metadata (name, symbol, price, market cap, etc.)
 *
 * This eliminates ad-hoc extraction scripts and ensures consistent behavior.
 */
import { DateTime } from 'luxon';
export interface ExtractedToken {
    /**
     * The canonical mint address (case-corrected, validated)
     */
    mint: string;
    /**
     * Source of the mint address (original message or bot message)
     */
    source: 'original' | 'bot' | 'validated';
    /**
     * Which bot message it came from (0 = first bot message, 1 = second, etc.)
     */
    botMessageIndex?: number;
    /**
     * Chain (solana, ethereum, bsc, base, etc.)
     */
    chain: string;
    /**
     * Token metadata extracted from bot messages
     */
    metadata?: {
        name?: string;
        symbol?: string;
        price?: number;
        marketCap?: number;
        volume?: number;
        liquidity?: number;
    };
    /**
     * Confidence score (0-1) for the extraction
     */
    confidence: number;
    /**
     * Original text where the address was found
     */
    originalText?: string;
}
export interface ChatMessage {
    sender: string;
    text: string;
    timestamp: string | DateTime;
    isBot?: boolean;
}
export interface ExtractionOptions {
    /**
     * Number of bot messages to check after the original message
     */
    botMessageLookahead?: number;
    /**
     * Whether to validate addresses by checking if they exist on-chain
     */
    validateOnChain?: boolean;
    /**
     * Whether to extract metadata from bot messages
     */
    extractMetadata?: boolean;
}
export declare class ChatExtractionEngine {
    private readonly BOT_PATTERNS;
    /**
     * Check if a sender is a bot
     */
    isBot(senderName: string): boolean;
    /**
     * Clean text for extraction (remove HTML, normalize entities)
     */
    private cleanText;
    /**
     * Extract token addresses from text with multiple fallback methods
     */
    private extractTokenAddresses;
    /**
     * Fix common address issues (missing chars, stray chars, case issues)
     */
    private fixAddressIssues;
    /**
     * Validate address format (basic validation)
     */
    private isValidAddress;
    /**
     * Extract metadata from bot message text
     */
    private extractMetadata;
    /**
     * Determine chain from address format
     */
    private determineChain;
    /**
     * Main extraction method - extracts tokens from original message and bot responses
     */
    extract(originalMessage: ChatMessage, botMessages?: ChatMessage[], options?: ExtractionOptions): Promise<ExtractedToken[]>;
    /**
     * Extract from a single message (simpler API)
     */
    extractFromMessage(message: ChatMessage, options?: ExtractionOptions): Promise<ExtractedToken[]>;
    /**
     * Batch extract from multiple messages
     */
    batchExtract(messages: ChatMessage[], options?: ExtractionOptions): Promise<Map<string, ExtractedToken[]>>;
}
/**
 * Get the singleton Chat Extraction Engine instance
 */
export declare function getChatExtractionEngine(): ChatExtractionEngine;
//# sourceMappingURL=chat-extraction-engine.d.ts.map