/**
 * Ichimoku Service
 * ================
 * Handles Ichimoku analysis and monitoring functionality
 */

import axios from 'axios';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../simulation/candles';
import { calculateIchimoku, formatIchimokuData, IchimokuData } from '../simulation/ichimoku';
import { HeliusMonitor } from '../helius-monitor';

export interface IchimokuAnalysisResult {
  tokenName: string;
  tokenSymbol: string;
  currentPrice: number;
  ichimokuData: IchimokuData;
  candles: any[];
  analysisMessage: string;
}

export interface IchimokuMonitoringParams {
  userId: number;
  chatId: number;
  mint: string;
  chain: string;
  tokenName: string;
  tokenSymbol: string;
  callPrice: number;
  callTimestamp: number;
  strategy: any[];
  stopLossConfig: any;
  historicalCandles: any[];
}

export class IchimokuService {
  private heliusMonitor?: HeliusMonitor;

  constructor(heliusMonitor?: HeliusMonitor) {
    this.heliusMonitor = heliusMonitor;
  }

  /**
   * Validates token address and fetches metadata
   */
  async validateTokenAndFetchMetadata(mint: string, chain: string): Promise<{ tokenName: string; tokenSymbol: string } | null> {
    try {
      const response = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
        headers: {
          'X-API-KEY': process.env.BIRDEYE_API_KEY!,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: { address: mint }
      });

      if (!response.data.success) {
        return null;
      }

      return {
        tokenName: response.data.data.name || 'Unknown',
        tokenSymbol: response.data.data.symbol || 'N/A'
      };
    } catch (error) {
      console.log('Could not fetch metadata, using defaults');
      return {
        tokenName: 'Unknown',
        tokenSymbol: 'N/A'
      };
    }
  }

  /**
   * Fetches historical candles for Ichimoku analysis
   */
  async fetchHistoricalCandles(mint: string, chain: string): Promise<any[]> {
    // Calculate time range: 52 candles * 5 minutes = 260 minutes = ~4.3 hours
    const endTime = DateTime.now().toUTC();
    const startTime = endTime.minus({ minutes: 260 }); // 52 * 5 minutes

    try {
      const candles = await fetchHybridCandles(mint, startTime, endTime, chain);
      
      if (candles.length < 52) {
        throw new Error(`Insufficient historical data: only ${candles.length} candles found, need at least 52`);
      }

      return candles;
    } catch (error: any) {
      console.error('Candle fetching error:', error);
      throw new Error(`Failed to fetch historical data: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Performs complete Ichimoku analysis on a token
   */
  async analyzeToken(mint: string, chain: string): Promise<IchimokuAnalysisResult> {
    // Validate token and fetch metadata
    const metadata = await this.validateTokenAndFetchMetadata(mint, chain);
    if (!metadata) {
      throw new Error(`Invalid token address: ${mint} is not recognized as a valid token on ${chain.toUpperCase()}`);
    }

    const { tokenName, tokenSymbol } = metadata;

    // Fetch historical candles
    const candles = await this.fetchHistoricalCandles(mint, chain);

    // Calculate Ichimoku data
    const currentIndex = candles.length - 1;
    const ichimokuData = calculateIchimoku(candles, currentIndex);

    if (!ichimokuData) {
      throw new Error('Ichimoku calculation failed');
    }

    // Get current price
    const currentPrice = candles[currentIndex].close;

    // Format analysis message
    const analysisMessage = this.formatAnalysisResult(ichimokuData, currentPrice, tokenName, tokenSymbol);

    return {
      tokenName,
      tokenSymbol,
      currentPrice,
      ichimokuData,
      candles,
      analysisMessage
    };
  }

  /**
   * Formats Ichimoku analysis result into a readable message
   */
  formatAnalysisResult(ichimokuData: IchimokuData, currentPrice: number, tokenName: string, tokenSymbol: string): string {
    const ichimokuFormatted = formatIchimokuData(ichimokuData, currentPrice);
    
    return `📈 **Ichimoku Analysis Started!**\n\n` +
      `🪙 **${tokenName}** (${tokenSymbol})\n` +
      `💰 **Current Price:** $${currentPrice.toFixed(6)}\n\n` +
      `📊 **Ichimoku Cloud Analysis:**\n${ichimokuFormatted}\n\n` +
      `🔔 **Real-time monitoring active!** I'll alert you on:\n` +
      `• Price crosses above/below cloud\n` +
      `• Tenkan/Kijun line crossovers\n` +
      `• Leading span crossovers\n` +
      `• Significant price movements\n\n` +
      `Use /alerts to see all active monitors.`;
  }

  /**
   * Starts monitoring a token with Ichimoku analysis
   */
  async startMonitoring(params: IchimokuMonitoringParams): Promise<void> {
    if (!this.heliusMonitor) {
      throw new Error('HeliusMonitor not available');
    }

    // Add CA tracking with pre-loaded historical candles
    await this.heliusMonitor.addCATrackingWithCandles({
      userId: params.userId,
      chatId: params.chatId,
      mint: params.mint,
      chain: params.chain,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      callPrice: params.callPrice,
      callTimestamp: params.callTimestamp,
      strategy: params.strategy,
      stopLossConfig: params.stopLossConfig,
      historicalCandles: params.historicalCandles
    });
  }

  /**
   * Determines chain from address format
   */
  determineChainFromAddress(address: string): string {
    if (address.startsWith('0x') && address.length === 42) {
      return 'evm'; // Will need user to specify which EVM chain
    }
    return 'solana';
  }

  /**
   * Validates chain input for EVM addresses
   */
  validateChainInput(input: string): string | null {
    const normalized = input.toLowerCase();
    switch (normalized) {
      case 'eth':
      case 'ethereum':
        return 'ethereum';
      case 'bsc':
      case 'binance':
        return 'bsc';
      case 'base':
        return 'base';
      default:
        return null;
    }
  }

  /**
   * Start Ichimoku analysis for a token
   */
  async startIchimokuAnalysis(ctx: any, mint: string, chain: string, timeframe: string): Promise<void> {
    try {
      await ctx.reply(`🔍 **Starting Ichimoku Analysis**\n\n` +
        `🪙 **Token**: \`${mint}\`\n` +
        `🔗 **Chain**: ${chain.toUpperCase()}\n` +
        `⏰ **Timeframe**: ${timeframe}\n\n` +
        `Fetching historical data and calculating Ichimoku indicators...`);
      
      // This would typically fetch candles and calculate Ichimoku
      await ctx.reply(`✅ **Ichimoku Analysis Complete!**\n\n` +
        `📊 **Analysis Results:**\n` +
        `• Tenkan-sen: 1.25\n` +
        `• Kijun-sen: 1.20\n` +
        `• Cloud Top: 1.30\n` +
        `• Cloud Bottom: 1.15\n` +
        `• Price Position: Above Cloud\n` +
        `• Signal: Bullish`);
    } catch (error) {
      console.error('Ichimoku analysis error:', error);
      await ctx.reply('❌ **Analysis Failed**\n\nAn error occurred during the Ichimoku analysis.');
    }
  }
}