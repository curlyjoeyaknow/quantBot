/**
 * CA (Contract Address) Service
 * ============================
 * Handles CA detection, validation, and processing logic
 */

import axios from 'axios';
import { saveCADrop } from '../utils/database';
import { HeliusMonitor } from '../helius-monitor';

export interface CADetectionResult {
  mint: string;
  chain: string;
}

export interface TokenMetadata {
  price?: number;
  mc?: number;
  name?: string;
  symbol?: string;
  [key: string]: any;
}

export interface CAProcessingParams {
  userId: number;
  chatId: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  callPrice?: number;
  callMarketcap?: number;
  callTimestamp?: number;
  strategy?: any[];
  stopLossConfig?: any;
}

export class CAService {
  private heliusMonitor?: HeliusMonitor;
  private readonly DEFAULT_STRATEGY = [
    { percent: 0.3, target: 2.0 },
    { percent: 0.3, target: 3.0 },
    { percent: 0.4, target: 5.0 }
  ];

  constructor(heliusMonitor?: HeliusMonitor) {
    this.heliusMonitor = heliusMonitor;
  }

  /**
   * Detects contract addresses in text and determines if it's a CA drop context
   */
  detectCADrop(message: string): CADetectionResult | null {
    const text = message.toLowerCase();
    
    // Check for CA drop context keywords
    const caKeywords = ['new token', 'contract', 'ca:', 'mint:', 'address:'];
    const hasCAContext = caKeywords.some(keyword => text.includes(keyword));
    
    if (!hasCAContext) {
      return null;
    }
    
    // Extract Solana address (base58, 32-44 characters)
    const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const solanaMatches = message.match(solanaRegex);
    
    if (solanaMatches && solanaMatches.length > 0) {
      return {
        mint: solanaMatches[0],
        chain: 'solana'
      };
    }
    
    // Extract Ethereum address (0x followed by 40 hex characters)
    const ethereumRegex = /0x[a-fA-F0-9]{40}/g;
    const ethereumMatches = message.match(ethereumRegex);
    
    if (ethereumMatches && ethereumMatches.length > 0) {
      return {
        mint: ethereumMatches[0],
        chain: 'ethereum'
      };
    }
    
    return null;
  }

  /**
   * Detects contract addresses in text and determines if it's a CA drop context
   */
  detectCAFromText(text: string): CADetectionResult[] {
    // Regex patterns for Solana and EVM addresses
    const solanaAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const evmAddressPattern = /0x[a-fA-F0-9]{40}/g;
    const solanaMatches = text.match(solanaAddressPattern);
    const evmMatches = text.match(evmAddressPattern);
    const addresses = [...(solanaMatches || []), ...(evmMatches || [])];

    if (addresses.length === 0) return [];

    // Detect if the message context really looks like a CA drop
    const caKeywords = ['ca', 'contract', 'address', 'buy', 'pump', 'moon', 'gem', 'call'];
    const hasCAKeywords = caKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
    
    if (!hasCAKeywords && addresses.length === 1) {
      // Ignore single addresses when not in a drop context
      return [];
    }

    console.log(`Potential CA drop detected: ${addresses.join(', ')}`);

    return addresses.map(address => ({
      mint: address,
      chain: this.determineChain(address)
    }));
  }

  /**
   * Determines the most likely chain for an address
   */
  private determineChain(address: string): string {
    if (address.startsWith('0x')) {
      return 'bsc'; // EVM heuristic: most new tokens first appear on BSC
    }
    return 'solana';
  }

  /**
   * Validates if an address has the correct format
   */
  validateTokenAddress(mint: string, chain: string): boolean {
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    
    if (chain === 'solana') {
      return solanaPattern.test(mint);
    } else {
      return evmPattern.test(mint);
    }
  }

  /**
   * Fetches token metadata from Birdeye API
   */
  async fetchTokenMetadata(mint: string, chain: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
        headers: {
          'X-API-KEY': process.env.BIRDEYE_API_KEY!,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: { address: mint }
      });

      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    } catch (error) {
      console.log(`Failed to fetch metadata for ${mint} on ${chain}`);
      return null;
    }
  }

  /**
   * Tries to find token metadata across multiple EVM chains
   */
  async findTokenAcrossChains(mint: string): Promise<{ metadata: TokenMetadata; chain: string } | null> {
    if (mint.startsWith('0x')) {
      // Try EVM chains
      const chainsToTry = ['bsc', 'ethereum', 'base'];
      for (const chain of chainsToTry) {
        try {
          console.log(`Trying ${chain} for address ${mint}`);
          const metadata = await this.fetchTokenMetadata(mint, chain);
          if (metadata) {
            console.log(`Found token on ${chain}: ${metadata.name}`);
            return { metadata, chain };
          }
        } catch (err) {
          console.log(`Failed to find token on ${chain}`);
          continue;
        }
      }
    } else {
      // Try Solana
      const metadata = await this.fetchTokenMetadata(mint, 'solana');
      if (metadata) {
        return { metadata, chain: 'solana' };
      }
    }

    console.log(`Token metadata not found for ${mint} on any supported chain`);
    return null;
  }

  /**
   * Processes a CA drop - validates, fetches metadata, saves to DB, and starts monitoring
   */
  async processCADrop(params: CAProcessingParams): Promise<void> {
    const { userId, chatId, mint } = params;

    // Validate address format
    if (!this.validateTokenAddress(mint, params.chain)) {
      console.log(`Invalid address format: ${mint}`);
      return;
    }

    try {
      // Find token metadata
      const result = await this.findTokenAcrossChains(mint);
      if (!result) {
        return;
      }

      const { metadata, chain: finalChain } = result;
      const currentPrice = metadata.price || 0;
      const marketcap = metadata.mc || 0;

      // Use default strategy and stop loss for auto CA monitoring
      const strategy = params.strategy || this.DEFAULT_STRATEGY;
      const stopLossConfig = params.stopLossConfig || { initial: -0.5, trailing: 0.5 };

      // Save CA drop in database
      const caId = await saveCADrop({
        userId,
        chatId,
        mint,
        chain: finalChain,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        callPrice: currentPrice,
        callMarketcap: marketcap,
        callTimestamp: Math.floor(Date.now() / 1000),
        strategy,
        stopLossConfig
      });

      // Start monitoring if Helius monitor is available and it's Solana
      if (this.heliusMonitor && finalChain === 'solana') {
        await this.heliusMonitor.addCATracking({
          id: caId,
          mint,
          chain: finalChain,
          tokenName: metadata.name,
          tokenSymbol: metadata.symbol,
          callPrice: currentPrice,
          callMarketcap: marketcap,
          callTimestamp: Math.floor(Date.now() / 1000),
          strategy,
          stopLossConfig,
          userId,
          chatId
        });
      }

      console.log(`CA drop processed: ${metadata.name} (${metadata.symbol}) on ${finalChain}`);
    } catch (error) {
      console.error('Error processing CA drop:', error);
      throw error;
    }
  }

  /**
   * Processes multiple CA drops from detected addresses
   */
  async processCADrops(userId: number, chatId: number, addresses: CADetectionResult[]): Promise<void> {
    for (const { mint, chain } of addresses) {
      try {
        await this.processCADrop({
          userId,
          chatId,
          mint,
          chain
        });
      } catch (error) {
        console.error(`Error processing CA drop for ${mint}:`, error);
      }
    }
  }

  /**
   * Get active CA tracking for a user
   */
  async getActiveCATracking(userId: number): Promise<any[]> {
    // This would typically query the database
    // For now, return empty array
    return [];
  }

  /**
   * Save a strategy for a user
   */
  async saveStrategy(userId: number, name: string, config: any): Promise<void> {
    // This would typically save to database
    console.log(`Saving strategy ${name} for user ${userId}:`, config);
  }

  /**
   * Run a simulation
   */
  async runSimulation(params: any): Promise<any> {
    // This would typically run the simulation engine
    console.log('Running simulation with params:', params);
    return {
      finalPnl: 0.15,
      totalCandles: 100,
      entryPrice: 1.0,
      finalPrice: 1.15,
      events: []
    };
  }
}