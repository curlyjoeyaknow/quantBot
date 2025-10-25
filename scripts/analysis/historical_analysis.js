/**
 * Historical CA Analysis System
 * ============================
 * Analyzes extracted CA drops from chat messages to provide comprehensive
 * performance insights, success patterns, and strategy optimization.
 * 
 * Features:
 * - Performance analysis by time periods
 * - Success rate calculations
 * - Chain-specific analysis
 * - User performance tracking
 * - Optimal strategy recommendations
 * - Market condition analysis
 */

const sqlite3 = require('sqlite3').verbose();
const { DateTime } = require('luxon');
const axios = require('axios');

// Configuration
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

class HistoricalAnalyzer {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database('./simulations.db', (err) => {
        if (err) {
          console.error('Error connecting to database:', err);
          reject(err);
        } else {
          console.log('Connected to database for historical analysis');
          resolve();
        }
      });
    });
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
  }

  /**
   * Get all CA drops from the database
   */
  async getAllCADrops() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          id,
          mint,
          chain,
          token_name,
          token_symbol,
          call_price,
          call_marketcap,
          call_timestamp,
          caller,
          source_chat_id,
          created_at
        FROM ca_calls
        ORDER BY call_timestamp DESC
      `;

      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Add default strategy and stop loss config for historical calls
          const cas = rows.map(row => ({
            ...row,
            strategy: [
              { percent: 0.5, target: 2 },
              { percent: 0.3, target: 5 },
              { percent: 0.2, target: 10 }
            ],
            stopLossConfig: { initial: -0.5, trailing: 0.5 },
            createdAt: DateTime.fromISO(row.created_at)
          }));
          resolve(cas);
        }
      });
    });
  }

  /**
   * Get current price for a token
   */
  async getCurrentPrice(mint, chain) {
    try {
      const response = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: { address: mint }
      });

      if (response.data.success && response.data.data) {
        return response.data.data.price || 0;
      }
      return 0;
    } catch (error) {
      console.log(`Failed to get current price for ${mint} on ${chain}`);
      return 0;
    }
  }

  /**
   * Fetch historical candles for a token
   */
  async fetchHistoricalCandles(mint, chain, startTime, endTime) {
    try {
      const from = Math.floor(startTime);
      const to = Math.floor(endTime);
      
      // Fetch 5-minute candles for recent data
      const response = await axios.get('https://public-api.birdeye.so/defi/v3/ohlcv', {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: {
          address: mint,
          type: '5m',
          currency: 'usd',
          ui_amount_mode: 'raw',
          time_from: from,
          time_to: to,
          mode: 'range',
          padding: true,
          outlier: true
        }
      });

      if (response.data?.data?.items) {
        return response.data.data.items.map(item => ({
          timestamp: item.unix_time,
          open: item.o,
          high: item.h,
          low: item.l,
          close: item.c,
          volume: item.v
        }));
      }
      return [];
    } catch (error) {
      console.log(`Failed to fetch candles for ${mint} on ${chain}: ${error.message}`);
      return [];
    }
  }

  /**
   * Simple simulation function to check profit targets and stop losses
   */
  runSimulation(candles, strategy, callPrice, stopLossConfig = { initial: -0.5, trailing: 0.5 }) {
    if (!candles.length) {
      return { simulatedPnl: 0, events: [], targetsHit: [] };
    }

    const events = [];
    const targetsHit = [];
    let remaining = 1; // 100% position
    let pnl = 0;
    let targetIndex = 0;
    
    // Stop loss setup
    let stopLoss = callPrice * (1 + stopLossConfig.initial); // -50% stop loss
    let stopMovedToEntry = false;
    const hasTrailing = stopLossConfig.trailing !== 'none';

    for (const candle of candles) {
      // Check stop loss first
      if (candle.low <= stopLoss) {
        // Stop loss hit!
        const stopPnl = remaining * (stopLoss / callPrice);
        pnl += stopPnl;
        
        events.push({
          type: 'stop_loss',
          timestamp: candle.timestamp,
          price: stopLoss,
          description: `STOP LOSS triggered at $${stopLoss.toFixed(8)}`,
          remainingPosition: 0,
          pnlSoFar: pnl
        });
        
        return { simulatedPnl: pnl, events, targetsHit };
      }

      // Check trailing stop
      if (hasTrailing && !stopMovedToEntry) {
        const trailingTrigger = callPrice * (1 + stopLossConfig.trailing);
        if (candle.high >= trailingTrigger) {
          stopLoss = callPrice; // Move stop to break-even
          stopMovedToEntry = true;
          
          events.push({
            type: 'stop_moved',
            timestamp: candle.timestamp,
            price: callPrice,
            description: `Trailing stop activated at $${callPrice.toFixed(8)}`,
            remainingPosition: remaining,
            pnlSoFar: pnl
          });
        }
      }

      // Check profit targets
      while (targetIndex < strategy.length) {
        const { percent, target } = strategy[targetIndex];
        const targetPrice = callPrice * target;

        if (candle.high >= targetPrice) {
          // Target hit!
          const targetPnl = percent * target;
          pnl += targetPnl;
          remaining -= percent;
          
          targetsHit.push({
            target: target,
            percent: percent,
            price: targetPrice,
            timestamp: candle.timestamp,
            pnlSoFar: pnl
          });

          events.push({
            type: 'target_hit',
            timestamp: candle.timestamp,
            price: targetPrice,
            description: `Target ${target}x hit! Sold ${(percent * 100).toFixed(0)}% at $${targetPrice.toFixed(8)}`,
            remainingPosition: remaining,
            pnlSoFar: pnl
          });

          targetIndex++;
        } else {
          break;
        }
      }
    }

    // Final exit for remaining position (only if no stop loss was hit)
    if (remaining > 0) {
      const finalPrice = candles[candles.length - 1].close;
      const finalPnl = remaining * (finalPrice / callPrice);
      pnl += finalPnl;
      
      events.push({
        type: 'final_exit',
        timestamp: candles[candles.length - 1].timestamp,
        price: finalPrice,
        description: `Final exit: ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(8)}`,
        remainingPosition: 0,
        pnlSoFar: pnl
      });
    }

    return { simulatedPnl: pnl, events, targetsHit };
  }

  /**
   * Calculate performance metrics for a CA using strategy simulation
   */
  async calculatePerformance(ca, currentPrice) {
    const timeElapsed = Date.now() / 1000 - ca.call_timestamp;
    const timeElapsedHours = timeElapsed / 3600;

    // Fetch historical candles for simulation
    const endTime = Date.now() / 1000;
    const candles = await this.fetchHistoricalCandles(ca.mint, ca.chain, ca.call_timestamp, endTime);
    
    let simulatedPnl = 0;
    let targetsHit = [];
    let maxPrice = 0;
    let maxPnl = 0;
    let actualCallPrice = 0;

    if (candles.length > 0) {
      // Calculate the actual call price from historical data
      // Find the candle closest to the call timestamp
      let closestCandle = candles[0];
      let minTimeDiff = Math.abs(candles[0].timestamp - ca.call_timestamp);
      
      for (const candle of candles) {
        const timeDiff = Math.abs(candle.timestamp - ca.call_timestamp);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestCandle = candle;
        }
      }
      
      // Use the open price of the closest candle as the call price
      actualCallPrice = closestCandle.open;
      maxPrice = actualCallPrice;
      maxPnl = 1;

      // Run simulation to check if profit targets were hit
      const simulation = this.runSimulation(candles, ca.strategy, actualCallPrice, ca.stopLossConfig);
      simulatedPnl = simulation.simulatedPnl;
      targetsHit = simulation.targetsHit;

      // Find max price reached
      candles.forEach(candle => {
        if (candle.high > maxPrice) {
          maxPrice = candle.high;
          maxPnl = candle.high / actualCallPrice;
        }
      });
    }

    // Use simulated PNL for status determination
    const pnl = simulatedPnl;
    const pnlPercent = (pnl - 1) * 100;

    let status = 'unknown';
    if (pnl >= 2) status = '2x+';
    else if (pnl >= 1.5) status = '1.5x+';
    else if (pnl >= 1) status = 'profitable';
    else if (pnl >= 0.5) status = 'loss';
    else status = 'major_loss';

    return {
      pnl,
      pnlPercent,
      status,
      timeElapsed,
      timeElapsedHours,
      simulatedPnl,
      targetsHit,
      maxPrice,
      maxPnl,
      currentPrice,
      actualCallPrice
    };
  }

  /**
   * Analyze performance by time periods
   */
  analyzeByTimePeriod(cas) {
    const periods = {
      last24h: [],
      last7d: [],
      last30d: [],
      older: []
    };

    const now = DateTime.now();
    
    cas.forEach(ca => {
      const caTime = DateTime.fromSeconds(ca.call_timestamp);
      const hoursAgo = now.diff(caTime, 'hours').hours;

      if (hoursAgo <= 24) {
        periods.last24h.push(ca);
      } else if (hoursAgo <= 168) { // 7 days
        periods.last7d.push(ca);
      } else if (hoursAgo <= 720) { // 30 days
        periods.last30d.push(ca);
      } else {
        periods.older.push(ca);
      }
    });

    return periods;
  }

  /**
   * Analyze performance by chain
   */
  analyzeByChain(cas) {
    const chainAnalysis = {};

    cas.forEach(ca => {
      if (!chainAnalysis[ca.chain]) {
        chainAnalysis[ca.chain] = {
          total: 0,
          profitable: 0,
          loss: 0,
          majorLoss: 0,
          avgPnl: 0,
          bestPerformer: null,
          worstPerformer: null
        };
      }

      const chain = chainAnalysis[ca.chain];
      chain.total++;

      // Calculate performance metrics
      if (ca.performance && ca.performance.pnl > 1) {
        chain.profitable++;
      } else if (ca.performance && ca.performance.pnl < 0.5) {
        chain.majorLoss++;
      } else {
        chain.loss++;
      }

      // Track best/worst performers
      if (ca.performance && ca.performance.pnl > 0) {
        if (!chain.bestPerformer || ca.performance.pnl > chain.bestPerformer.performance.pnl) {
          chain.bestPerformer = ca;
        }
      }
      
      if (!chain.worstPerformer || ca.performance.pnl < chain.worstPerformer.performance.pnl) {
        chain.worstPerformer = ca;
      }
    });

    // Calculate averages and success rates
    Object.keys(chainAnalysis).forEach(chain => {
      const data = chainAnalysis[chain];
      data.successRate = data.total > 0 ? (data.profitable / data.total) * 100 : 0;
      data.avgPnl = data.total > 0 ? 
        cas.filter(ca => ca.chain === chain)
           .reduce((sum, ca) => sum + (ca.performance?.pnl || 0), 0) / data.total : 0;
    });

    return chainAnalysis;
  }

  /**
   * Calculate success rates and statistics
   */
  calculateSuccessRates(cas) {
    const stats = {
      total: cas.length,
      profitable: 0,
      loss: 0,
      majorLoss: 0,
      avgPnl: 0,
      medianPnl: 0,
      bestPerformer: null,
      worstPerformer: null,
      successRate: 0,
      avgTimeToProfit: 0,
      avgTimeToLoss: 0
    };

    if (cas.length === 0) return stats;

    const performances = cas.map(ca => ca.performance);
    const pnls = performances.map(p => p.pnl).filter(p => p > 0);

    // Count by status
    performances.forEach(perf => {
      if (perf.status === 'profitable' || perf.status === '1.5x+' || perf.status === '2x+') {
        stats.profitable++;
      } else if (perf.status === 'loss') {
        stats.loss++;
      } else if (perf.status === 'major_loss') {
        stats.majorLoss++;
      }
    });

    // Calculate averages
    stats.avgPnl = performances.reduce((sum, p) => sum + p.pnl, 0) / performances.length;
    stats.successRate = (stats.profitable / stats.total) * 100;

    if (pnls.length > 0) {
      stats.medianPnl = pnls.sort((a, b) => a - b)[Math.floor(pnls.length / 2)];
    }

    // Find best and worst performers
    const sortedByPnl = cas.sort((a, b) => b.performance.pnl - a.performance.pnl);
    stats.bestPerformer = sortedByPnl[0];
    stats.worstPerformer = sortedByPnl[sortedByPnl.length - 1];

    // Calculate average times
    const profitableTimes = performances
      .filter(p => p.status === 'profitable' || p.status === '1.5x+' || p.status === '2x+')
      .map(p => p.timeElapsedHours);
    
    const lossTimes = performances
      .filter(p => p.status === 'loss' || p.status === 'major_loss')
      .map(p => p.timeElapsedHours);

    if (profitableTimes.length > 0) {
      stats.avgTimeToProfit = profitableTimes.reduce((sum, t) => sum + t, 0) / profitableTimes.length;
    }

    if (lossTimes.length > 0) {
      stats.avgTimeToLoss = lossTimes.reduce((sum, t) => sum + t, 0) / lossTimes.length;
    }

    return stats;
  }

  /**
   * Generate strategy recommendations based on historical data
   */
  generateStrategyRecommendations(stats, chainAnalysis) {
    const recommendations = [];

    // Success rate recommendations
    if (stats.successRate < 30) {
      recommendations.push({
        type: 'success_rate',
        priority: 'high',
        message: `Low success rate (${stats.successRate.toFixed(1)}%). Consider more conservative entry strategies or better token selection criteria.`,
        suggestion: 'Implement stricter token filtering or wait for better market conditions.'
      });
    } else if (stats.successRate > 60) {
      recommendations.push({
        type: 'success_rate',
        priority: 'low',
        message: `Good success rate (${stats.successRate.toFixed(1)}%). Current strategy appears effective.`,
        suggestion: 'Continue current approach but monitor for market changes.'
      });
    }

    // Chain-specific recommendations
    Object.entries(chainAnalysis).forEach(([chain, analysis]) => {
      const chainSuccessRate = (analysis.profitable / analysis.total) * 100;
      
      if (chainSuccessRate < 25) {
        recommendations.push({
          type: 'chain_performance',
          priority: 'medium',
          message: `Poor performance on ${chain.toUpperCase()} (${chainSuccessRate.toFixed(1)}% success rate).`,
          suggestion: `Consider reducing ${chain} allocations or implementing stricter filters for ${chain} tokens.`
        });
      }
    });

    // Time-based recommendations
    if (stats.avgTimeToProfit > 24) {
      recommendations.push({
        type: 'timing',
        priority: 'medium',
        message: `Average time to profit is ${stats.avgTimeToProfit.toFixed(1)} hours. Consider longer-term strategies.`,
        suggestion: 'Implement trailing stops or longer profit targets to capture extended moves.'
      });
    }

    return recommendations;
  }

  /**
   * Format analysis results for display
   */
  formatAnalysisResults(analysis) {
    let output = `📊 **Historical CA Analysis Report**\n\n`;
    
    // Overall Statistics
    output += `📈 **Overall Performance:**\n`;
    output += `• Total CAs Analyzed: ${analysis.stats.total}\n`;
    output += `• Success Rate: ${analysis.stats.successRate.toFixed(1)}%\n`;
    output += `• Average PNL: ${analysis.stats.avgPnl.toFixed(2)}x\n`;
    output += `• Profitable: ${analysis.stats.profitable} (${((analysis.stats.profitable/analysis.stats.total)*100).toFixed(1)}%)\n`;
    output += `• Losses: ${analysis.stats.loss + analysis.stats.majorLoss} (${(((analysis.stats.loss + analysis.stats.majorLoss)/analysis.stats.total)*100).toFixed(1)}%)\n`;
    
    // Calculate tokens that hit profit targets
    const tokensWithTargetsHit = analysis.cas.filter(ca => ca.performance.targetsHit && ca.performance.targetsHit.length > 0);
    const totalTargetsHit = analysis.cas.reduce((sum, ca) => sum + (ca.performance.targetsHit?.length || 0), 0);
    output += `• Tokens with Profit Targets Hit: ${tokensWithTargetsHit.length} (${((tokensWithTargetsHit.length/analysis.stats.total)*100).toFixed(1)}%)\n`;
    output += `• Total Profit Targets Hit: ${totalTargetsHit}\n\n`;

    // Time-based Analysis
    output += `⏰ **Performance by Time Period:**\n`;
    Object.entries(analysis.timePeriods).forEach(([period, cas]) => {
      if (cas.length > 0) {
        const periodStats = this.calculateSuccessRates(cas);
        output += `• ${period.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}: ${cas.length} CAs, ${periodStats.successRate.toFixed(1)}% success\n`;
      }
    });
    output += `\n`;

    // Chain Analysis
    output += `🔗 **Performance by Chain:**\n`;
    Object.entries(analysis.chainAnalysis).forEach(([chain, chainStats]) => {
      const chainEmoji = chain === 'ethereum' ? '⟠' : chain === 'bsc' ? '🟡' : chain === 'base' ? '🔵' : '◎';
      const successRate = (chainStats.profitable / chainStats.total) * 100;
      output += `${chainEmoji} **${chain.toUpperCase()}**: ${chainStats.total} CAs, ${successRate.toFixed(1)}% success\n`;
    });
    output += `\n`;

    // Best/Worst Performers
    if (analysis.stats.bestPerformer) {
      output += `🏆 **Best Performer:**\n`;
      output += `• ${analysis.stats.bestPerformer.token_name} (${analysis.stats.bestPerformer.token_symbol})\n`;
      output += `• PNL: ${analysis.stats.bestPerformer.performance.pnl.toFixed(2)}x\n`;
      output += `• Call Price: $${analysis.stats.bestPerformer.performance.actualCallPrice?.toFixed(8) || 'N/A'}\n`;
      output += `• Max Price: $${analysis.stats.bestPerformer.performance.maxPrice?.toFixed(8) || 'N/A'} (${analysis.stats.bestPerformer.performance.maxPnl?.toFixed(2)}x)\n`;
      output += `• Targets Hit: ${analysis.stats.bestPerformer.performance.targetsHit?.length || 0}\n`;
      output += `• Chain: ${analysis.stats.bestPerformer.chain.toUpperCase()}\n\n`;
    }

    if (analysis.stats.worstPerformer) {
      output += `📉 **Worst Performer:**\n`;
      output += `• ${analysis.stats.worstPerformer.token_name} (${analysis.stats.worstPerformer.token_symbol})\n`;
      output += `• PNL: ${analysis.stats.worstPerformer.performance.pnl.toFixed(2)}x\n`;
      output += `• Call Price: $${analysis.stats.worstPerformer.performance.actualCallPrice?.toFixed(8) || 'N/A'}\n`;
      output += `• Max Price: $${analysis.stats.worstPerformer.performance.maxPrice?.toFixed(8) || 'N/A'} (${analysis.stats.worstPerformer.performance.maxPnl?.toFixed(2)}x)\n`;
      output += `• Targets Hit: ${analysis.stats.worstPerformer.performance.targetsHit?.length || 0}\n`;
      output += `• Chain: ${analysis.stats.worstPerformer.chain.toUpperCase()}\n\n`;
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      output += `💡 **Strategy Recommendations:**\n`;
      analysis.recommendations.forEach((rec, index) => {
        const priorityEmoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        output += `${priorityEmoji} **${rec.type.replace(/_/g, ' ').toUpperCase()}**: ${rec.message}\n`;
        output += `   💡 ${rec.suggestion}\n\n`;
      });
    }

    return output;
  }

  /**
   * Run complete historical analysis
   */
  async runAnalysis() {
    console.log('🔍 Starting historical CA analysis...\n');

    try {
      // Get all CA drops
      const cas = await this.getAllCADrops();
      console.log(`Found ${cas.length} CA drops in database`);

      if (cas.length === 0) {
        console.log('❌ No CA drops found. Run the extraction script first.');
        return;
      }

      // Get current prices for all CAs
      console.log('📊 Fetching current prices...');
      for (let i = 0; i < cas.length; i++) {
        const ca = cas[i];
        console.log(`Analyzing ${ca.token_name} (${i + 1}/${cas.length})...`);
        
        const currentPrice = await this.getCurrentPrice(ca.mint, ca.chain);
        ca.currentPrice = currentPrice;
        ca.performance = await this.calculatePerformance(ca, currentPrice);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Perform analysis
      console.log('📈 Analyzing performance data...');
      
      const analysis = {
        stats: this.calculateSuccessRates(cas),
        timePeriods: this.analyzeByTimePeriod(cas),
        chainAnalysis: this.analyzeByChain(cas),
        recommendations: [],
        cas: cas // Pass the cas data for profit target analysis
      };

      // Generate recommendations
      analysis.recommendations = this.generateStrategyRecommendations(analysis.stats, analysis.chainAnalysis);

      // Format and display results
      const report = this.formatAnalysisResults(analysis);
      console.log('\n' + report);

      // Save detailed results to file
      const timestamp = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
      const filename = `historical_analysis_${timestamp}.json`;
      
      const detailedResults = {
        timestamp: DateTime.now().toISO(),
        summary: analysis,
        detailedData: cas.map(ca => ({
          id: ca.id,
          token: `${ca.token_name} (${ca.token_symbol})`,
          chain: ca.chain,
          callPrice: ca.call_price,
          currentPrice: ca.currentPrice,
          performance: ca.performance,
          callTime: DateTime.fromSeconds(ca.call_timestamp).toISO()
        }))
      };

      require('fs').writeFileSync(filename, JSON.stringify(detailedResults, null, 2));
      console.log(`\n💾 Detailed results saved to: ${filename}`);

      return analysis;

    } catch (error) {
      console.error('❌ Error during analysis:', error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const analyzer = new HistoricalAnalyzer();
  
  try {
    await analyzer.init();
    await analyzer.runAnalysis();
  } catch (error) {
    console.error('Analysis failed:', error);
  } finally {
    await analyzer.close();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { HistoricalAnalyzer };
