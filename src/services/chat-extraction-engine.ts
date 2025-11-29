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

import { logger } from '../utils/logger';
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

export class ChatExtractionEngine {
  private readonly BOT_PATTERNS = [
    /rick/i,
    /phanes/i,
    /bot/i,
    /wenpresale/i,
    /presale/i,
    /gempad/i,
  ];

  /**
   * Check if a sender is a bot
   */
  isBot(senderName: string): boolean {
    const senderLower = senderName.toLowerCase();
    return this.BOT_PATTERNS.some(pattern => pattern.test(senderLower));
  }

  /**
   * Clean text for extraction (remove HTML, normalize entities)
   */
  private cleanText(text: string): string {
    let clean = text.replace(/<[^>]+>/g, ' ');
    clean = clean.replace(/&apos;/g, "'");
    clean = clean.replace(/&quot;/g, '"');
    clean = clean.replace(/&amp;/g, '&');
    clean = clean.replace(/&nbsp;/g, ' ');
    return clean;
  }

  /**
   * Extract token addresses from text with multiple fallback methods
   */
  private extractTokenAddresses(text: string): string[] {
    const addresses: string[] = [];
    const cleanText = this.cleanText(text);
    
    // Method 1: Solana base58 addresses (32-44 chars)
    const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const solanaMatches = cleanText.match(solanaRegex) || [];
    const validSolana = solanaMatches.filter(addr => {
      const len = addr.length;
      if (len < 32 || len > 44) return false;
      // Reject common false positives
      if (addr.toUpperCase().startsWith('DEF')) return false;
      return true;
    });
    addresses.push(...validSolana);
    
    // Method 2: EVM addresses (0x + 40 hex chars)
    const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
    const evmMatches = cleanText.match(evmRegex) || [];
    addresses.push(...evmMatches);
    
    // Method 3: Addresses in code blocks (common in bot messages)
    const codeBlockRegex = /`([1-9A-HJ-NP-Za-km-z]{32,44})`/g;
    const codeMatches = cleanText.match(codeBlockRegex) || [];
    codeMatches.forEach(match => {
      const addr = match.replace(/`/g, '').trim();
      if (addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
        if (!addresses.includes(addr)) {
          addresses.push(addr);
        }
      }
    });
    
    // Method 4: Phanes bot format: "├ ADDRESS└"
    const phanesFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*└/g;
    const phanesMatches = cleanText.matchAll(phanesFormatRegex);
    for (const match of phanesMatches) {
      const addr = match[1];
      if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
        if (!addresses.includes(addr)) {
          addresses.push(addr);
        }
      }
    }
    
    // Method 5: Addresses after "├" (Phanes bot format)
    const pipeFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})/g;
    const pipeMatches = cleanText.matchAll(pipeFormatRegex);
    for (const match of pipeMatches) {
      const addr = match[1];
      if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
        if (!addresses.includes(addr)) {
          addresses.push(addr);
        }
      }
    }
    
    // Remove duplicates (preserve case for Solana, lowercase for EVM)
    const unique = new Set<string>();
    addresses.forEach(addr => {
      if (addr.startsWith('0x')) {
        unique.add(addr.toLowerCase());
      } else {
        unique.add(addr); // Keep original case for Solana
      }
    });
    
    return Array.from(unique);
  }

  /**
   * Fix common address issues (missing chars, stray chars, case issues)
   */
  private fixAddressIssues(address: string, referenceAddress?: string): string {
    let fixed = address.trim();
    
    // Remove common stray characters that might be in the middle
    // But be careful - don't remove valid base58 characters
    // Only remove obvious separators or formatting
    fixed = fixed.replace(/[^\w]/g, '');
    
    // Remove leading/trailing invalid characters
    fixed = fixed.replace(/^[^1-9A-HJ-NP-Za-km-z0-9x]+/, '');
    fixed = fixed.replace(/[^1-9A-HJ-NP-Za-km-z0-9]+$/, '');
    
    // If we have a reference address (from bot), prefer it for case correction
    if (referenceAddress && fixed.length === referenceAddress.length) {
      // If lengths match, use reference case for Solana addresses
      if (!fixed.startsWith('0x')) {
        // If case-insensitive match, use bot's version (likely correct case)
        if (fixed.toLowerCase() === referenceAddress.toLowerCase()) {
          return referenceAddress; // Use bot's version (likely correct case)
        }
      } else {
        // For EVM, always lowercase
        return fixed.toLowerCase();
      }
    }
    
    // For EVM addresses, normalize to lowercase
    if (fixed.startsWith('0x')) {
      return fixed.toLowerCase();
    }
    
    return fixed;
  }

  /**
   * Validate address format (basic validation)
   */
  private isValidAddress(address: string): boolean {
    // Solana: base58, 32-44 chars
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    // EVM: 0x + 40 hex chars
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    
    return solanaPattern.test(address) || evmPattern.test(address);
  }

  /**
   * Extract metadata from bot message text
   */
  private extractMetadata(text: string, tokenAddress: string): ExtractedToken['metadata'] {
    const metadata: ExtractedToken['metadata'] = {};
    
    // Extract symbol from ($SYMBOL) or $SYMBOL
    const symbolMatch = text.match(/\$([A-Z0-9]+)/);
    if (symbolMatch) {
      metadata.symbol = symbolMatch[1];
    }
    
    // Extract name - look for pattern like "Token Name ($SYMBOL)" or "Token Name ["
    const nameMatch = text.match(/(?:🟣|🐶|🟢|🔷|🪙)\s*([^($\[]+?)(?:\s*\(|\s*\[|\s*\$)/);
    if (nameMatch) {
      metadata.name = nameMatch[1].trim();
    }
    
    // Extract price - look for "USD: $0.0001" or "$0.0₄5872" (Phanes format with subscript)
    const priceMatch = text.match(/USD:\s*\$?([0-9.,]+(?:₀|₁|₂|₃|₄|₅|₆|₇|₈|₉)?[0-9]*)/);
    if (priceMatch) {
      // Handle subscript notation (e.g., 0.0₄5872 = 0.00005872)
      let priceStr = priceMatch[1]
        .replace(/₀/g, '0').replace(/₁/g, '1').replace(/₂/g, '2')
        .replace(/₃/g, '3').replace(/₄/g, '4').replace(/₅/g, '5')
        .replace(/₆/g, '6').replace(/₇/g, '7').replace(/₈/g, '8').replace(/₉/g, '9');
      priceStr = priceStr.replace(/,/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        metadata.price = price;
      }
    }
    
    // Extract market cap - look for "MC: $100K" or "FDV: $100K" or "[100K/"
    const mcMatch = text.match(/(?:MC|FDV):\s*\$?([0-9.,]+[KM]?)/i) || text.match(/\[([0-9.,]+[KM]?)\//);
    if (mcMatch) {
      let mcStr = mcMatch[1].replace(/,/g, '');
      let multiplier = 1;
      if (mcStr.endsWith('K') || mcStr.endsWith('k')) {
        multiplier = 1000;
        mcStr = mcStr.slice(0, -1);
      } else if (mcStr.endsWith('M') || mcStr.endsWith('m')) {
        multiplier = 1000000;
        mcStr = mcStr.slice(0, -1);
      } else if (mcStr.endsWith('B') || mcStr.endsWith('b')) {
        multiplier = 1000000000;
        mcStr = mcStr.slice(0, -1);
      }
      const mc = parseFloat(mcStr) * multiplier;
      if (!isNaN(mc) && mc > 0) {
        metadata.marketCap = mc;
      }
    }
    
    // Extract volume
    const volMatch = text.match(/Vol:\s*\$?([0-9.,]+[KM]?)/i);
    if (volMatch) {
      let volStr = volMatch[1].replace(/,/g, '');
      let multiplier = 1;
      if (volStr.endsWith('K') || volStr.endsWith('k')) {
        multiplier = 1000;
        volStr = volStr.slice(0, -1);
      } else if (volStr.endsWith('M') || volStr.endsWith('m')) {
        multiplier = 1000000;
        volStr = volStr.slice(0, -1);
      }
      const vol = parseFloat(volStr) * multiplier;
      if (!isNaN(vol) && vol > 0) {
        metadata.volume = vol;
      }
    }
    
    // Extract liquidity
    const liqMatch = text.match(/(?:LP|Liq):\s*\$?([0-9.,]+[KM]?)/i);
    if (liqMatch) {
      let liqStr = liqMatch[1].replace(/,/g, '');
      let multiplier = 1;
      if (liqStr.endsWith('K') || liqStr.endsWith('k')) {
        multiplier = 1000;
        liqStr = liqStr.slice(0, -1);
      } else if (liqStr.endsWith('M') || liqStr.endsWith('m')) {
        multiplier = 1000000;
        liqStr = liqStr.slice(0, -1);
      }
      const liq = parseFloat(liqStr) * multiplier;
      if (!isNaN(liq) && liq > 0) {
        metadata.liquidity = liq;
      }
    }
    
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Determine chain from address format
   */
  private determineChain(address: string, text?: string): string {
    if (address.startsWith('0x')) {
      // Check text for chain hints
      if (text) {
        const textLower = text.toLowerCase();
        if (textLower.includes('base') || textLower.includes('network=base')) {
          return 'base';
        }
        if (textLower.includes('ethereum') || textLower.includes('eth network')) {
          return 'ethereum';
        }
        if (textLower.includes('bsc') || textLower.includes('binance')) {
          return 'bsc';
        }
      }
      // Default EVM chains - try BSC first (most common for new tokens)
      return 'bsc';
    }
    return 'solana';
  }

  /**
   * Main extraction method - extracts tokens from original message and bot responses
   */
  async extract(
    originalMessage: ChatMessage,
    botMessages: ChatMessage[] = [],
    options: ExtractionOptions = {}
  ): Promise<ExtractedToken[]> {
    const {
      botMessageLookahead = 2,
      extractMetadata = true
    } = options;

    const extracted: ExtractedToken[] = [];
    const seenAddresses = new Set<string>();

    // Step 1: Extract from original message
    const originalAddresses = this.extractTokenAddresses(originalMessage.text);
    for (const addr of originalAddresses) {
      const fixed = this.fixAddressIssues(addr);
      
      // Validate address format
      if (!this.isValidAddress(fixed)) {
        logger.debug('Invalid address format, skipping', { address: fixed.substring(0, 20) });
        continue;
      }
      
      const key = fixed.toLowerCase();
      
      if (!seenAddresses.has(key)) {
        seenAddresses.add(key);
        extracted.push({
          mint: fixed,
          source: 'original',
          chain: this.determineChain(fixed, originalMessage.text),
          confidence: 0.7, // Lower confidence for original message (might have typos)
          originalText: originalMessage.text
        });
      }
    }

    // Step 2: Extract from bot messages (next 2 bot messages)
    const botMessagesToCheck = botMessages
      .filter(msg => this.isBot(msg.sender))
      .slice(0, botMessageLookahead);

    for (let i = 0; i < botMessagesToCheck.length; i++) {
      const botMsg = botMessagesToCheck[i];
      const botAddresses = this.extractTokenAddresses(botMsg.text);
      
      for (const addr of botAddresses) {
        const fixed = this.fixAddressIssues(addr);
        
        // Validate address format
        if (!this.isValidAddress(fixed)) {
          logger.debug('Invalid address format from bot, skipping', { address: fixed.substring(0, 20) });
          continue;
        }
        
        const key = fixed.toLowerCase();
        
        // Check if we already have this address from original message
        const existingIndex = extracted.findIndex(
          e => e.mint.toLowerCase() === key
        );
        
        if (existingIndex >= 0) {
          // Update existing entry with bot's version (likely more accurate)
          const existing = extracted[existingIndex];
          extracted[existingIndex] = {
            ...existing,
            mint: fixed, // Use bot's version (correct case)
            source: 'validated', // Mark as validated by bot
            botMessageIndex: i,
            confidence: 0.95, // High confidence from bot
            metadata: extractMetadata ? this.extractMetadata(botMsg.text, fixed) : existing.metadata,
            originalText: botMsg.text
          };
        } else if (!seenAddresses.has(key)) {
          // New address from bot
          seenAddresses.add(key);
          extracted.push({
            mint: fixed,
            source: 'bot',
            botMessageIndex: i,
            chain: this.determineChain(fixed, botMsg.text),
            metadata: extractMetadata ? this.extractMetadata(botMsg.text, fixed) : undefined,
            confidence: 0.9, // High confidence from bot
            originalText: botMsg.text
          });
        }
      }
    }

    // Step 3: If we found addresses in bot messages, prefer those over original
    // (bots usually have correct case and formatting)
    const botExtracted = extracted.filter(e => e.source === 'bot' || e.source === 'validated');
    if (botExtracted.length > 0) {
      // Remove original-only addresses that might be typos
      const botAddresses = new Set(botExtracted.map(e => e.mint.toLowerCase()));
      return extracted.filter(e => 
        e.source === 'bot' || 
        e.source === 'validated' || 
        botAddresses.has(e.mint.toLowerCase())
      );
    }

    return extracted;
  }

  /**
   * Extract from a single message (simpler API)
   */
  async extractFromMessage(
    message: ChatMessage,
    options: ExtractionOptions = {}
  ): Promise<ExtractedToken[]> {
    return this.extract(message, [], options);
  }

  /**
   * Batch extract from multiple messages
   */
  async batchExtract(
    messages: ChatMessage[],
    options: ExtractionOptions = {}
  ): Promise<Map<string, ExtractedToken[]>> {
    const results = new Map<string, ExtractedToken[]>();
    
    // Group messages by conversation (simple: consecutive messages from same sender)
    for (let i = 0; i < messages.length; i++) {
      const original = messages[i];
      if (this.isBot(original.sender)) {
        continue; // Skip bot messages as originals
      }
      
      // Find next bot messages
      const botMessages: ChatMessage[] = [];
      for (let j = i + 1; j < Math.min(messages.length, i + 10); j++) {
        if (this.isBot(messages[j].sender)) {
          botMessages.push(messages[j]);
          if (botMessages.length >= (options.botMessageLookahead || 2)) {
            break;
          }
        }
      }
      
      const extracted = await this.extract(original, botMessages, options);
      if (extracted.length > 0) {
        const key = `${original.sender}_${original.timestamp}`;
        results.set(key, extracted);
      }
    }
    
    return results;
  }
}

// Singleton instance
let engineInstance: ChatExtractionEngine | null = null;

/**
 * Get the singleton Chat Extraction Engine instance
 */
export function getChatExtractionEngine(): ChatExtractionEngine {
  if (!engineInstance) {
    engineInstance = new ChatExtractionEngine();
  }
  return engineInstance;
}

