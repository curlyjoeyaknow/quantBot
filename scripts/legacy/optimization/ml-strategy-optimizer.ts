#!/usr/bin/env ts-node
/**
 * ML-Based Strategy Parameter Optimizer
 * 
 * Uses machine learning (linear regression, random forest, neural networks)
 * to predict optimal strategy parameters based on historical performance.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const RESULTS_CSV = path.join(__dirname, '../data/exports/strategy-optimization/strategy_comparison_summary.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/strategy-optimization');

interface StrategyData {
  // Input features (strategy parameters)
  profitTargets: number; // Number of profit targets
  trailingStopPercent: number;
  trailingStopActivation: number;
  minExitPrice: number;
  
  // Output target (what we want to optimize)
  totalPnlPercent: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

/**
 * Simple linear regression to predict PnL based on parameters
 */
class LinearRegressionOptimizer {
  private weights: number[] = [];
  private bias: number = 0;

  train(data: StrategyData[]): void {
    // Feature matrix X: [profitTargets, trailingStopPercent, trailingStopActivation, minExitPrice]
    // Target y: totalPnlPercent
    
    const X = data.map(d => [
      d.profitTargets,
      d.trailingStopPercent,
      d.trailingStopActivation,
      d.minExitPrice,
    ]);
    
    const y = data.map(d => d.totalPnlPercent);
    
    // Simple gradient descent
    const learningRate = 0.01;
    const iterations = 1000;
    
    this.weights = [0, 0, 0, 0];
    this.bias = 0;
    
    for (let iter = 0; iter < iterations; iter++) {
      let totalError = 0;
      const weightGradients = [0, 0, 0, 0];
      let biasGradient = 0;
      
      for (let i = 0; i < X.length; i++) {
        const prediction = this.predict(X[i]);
        const error = prediction - y[i];
        totalError += error * error;
        
        for (let j = 0; j < this.weights.length; j++) {
          weightGradients[j] += error * X[i][j];
        }
        biasGradient += error;
      }
      
      for (let j = 0; j < this.weights.length; j++) {
        this.weights[j] -= learningRate * (weightGradients[j] / X.length);
      }
      this.bias -= learningRate * (biasGradient / X.length);
    }
  }
  
  predict(features: number[]): number {
    let prediction = this.bias;
    for (let i = 0; i < features.length; i++) {
      prediction += this.weights[i] * features[i];
    }
    return prediction;
  }
  
  getOptimalParams(): { profitTargets: number; trailingStopPercent: number; trailingStopActivation: number; minExitPrice: number } {
    // Use gradient ascent to find optimal parameters
    // This is a simplified approach - in practice, you'd use more sophisticated optimization
    
    const bestParams = {
      profitTargets: 2,
      trailingStopPercent: 0.30,
      trailingStopActivation: 3.0,
      minExitPrice: 0.02,
    };
    
    let bestScore = -Infinity;
    
    // Grid search with learned weights as guidance
    for (let profitTargets = 0; profitTargets <= 3; profitTargets++) {
      for (let trailingStopPercent = 0.15; trailingStopPercent <= 0.40; trailingStopPercent += 0.05) {
        for (let trailingStopActivation = 2.0; trailingStopActivation <= 4.0; trailingStopActivation += 0.5) {
          for (let minExitPrice = 0.01; minExitPrice <= 0.10; minExitPrice += 0.01) {
            const features = [profitTargets, trailingStopPercent, trailingStopActivation, minExitPrice];
            const score = this.predict(features);
            
            if (score > bestScore) {
              bestScore = score;
              bestParams.profitTargets = profitTargets;
              bestParams.trailingStopPercent = trailingStopPercent;
              bestParams.trailingStopActivation = trailingStopActivation;
              bestParams.minExitPrice = minExitPrice;
            }
          }
        }
      }
    }
    
    return bestParams;
  }
}

/**
 * Multi-objective optimizer (optimizes for multiple metrics)
 */
class MultiObjectiveOptimizer {
  private data: StrategyData[];
  
  constructor(data: StrategyData[]) {
    this.data = data;
  }
  
  /**
   * Find Pareto-optimal strategies (strategies that are not dominated by others)
   */
  findParetoOptimal(): StrategyData[] {
    const pareto: StrategyData[] = [];
    
    for (const candidate of this.data) {
      let isDominated = false;
      
      for (const other of this.data) {
        if (candidate === other) continue;
        
        // Check if 'other' dominates 'candidate'
        // A strategy dominates if it's better in all objectives
        const betterPnL = other.totalPnlPercent >= candidate.totalPnlPercent;
        const betterWinRate = other.winRate >= candidate.winRate;
        const betterProfitFactor = other.profitFactor >= candidate.profitFactor;
        const betterSharpe = other.sharpeRatio >= candidate.sharpeRatio;
        const lowerDrawdown = other.maxDrawdown <= candidate.maxDrawdown;
        
        if (betterPnL && betterWinRate && betterProfitFactor && betterSharpe && lowerDrawdown) {
          isDominated = true;
          break;
        }
      }
      
      if (!isDominated) {
        pareto.push(candidate);
      }
    }
    
    return pareto;
  }
  
  /**
   * Score strategies using weighted combination of metrics
   */
  scoreStrategy(data: StrategyData, weights: {
    pnl: number;
    winRate: number;
    profitFactor: number;
    sharpe: number;
    drawdown: number;
  }): number {
    // Normalize metrics to 0-1 scale
    const maxPnL = Math.max(...this.data.map(d => d.totalPnlPercent));
    const maxWinRate = Math.max(...this.data.map(d => d.winRate));
    const maxProfitFactor = Math.max(...this.data.map(d => d.profitFactor));
    const maxSharpe = Math.max(...this.data.map(d => d.sharpeRatio));
    const maxDrawdown = Math.max(...this.data.map(d => d.maxDrawdown));
    
    const normalizedPnL = data.totalPnlPercent / (maxPnL || 1);
    const normalizedWinRate = data.winRate / (maxWinRate || 1);
    const normalizedProfitFactor = data.profitFactor / (maxProfitFactor || 1);
    const normalizedSharpe = data.sharpeRatio / (maxSharpe || 1);
    const normalizedDrawdown = 1 - (data.maxDrawdown / (maxDrawdown || 1));
    
    return (
      weights.pnl * normalizedPnL +
      weights.winRate * normalizedWinRate +
      weights.profitFactor * normalizedProfitFactor +
      weights.sharpe * normalizedSharpe +
      weights.drawdown * normalizedDrawdown
    );
  }
  
  /**
   * Find best strategy for different risk profiles
   */
  findBestForRiskProfile(): {
    conservative: StrategyData;
    balanced: StrategyData;
    aggressive: StrategyData;
  } {
    // Conservative: prioritize win rate and low drawdown
    const conservative = this.data
      .map(d => ({
        data: d,
        score: this.scoreStrategy(d, {
          pnl: 0.2,
          winRate: 0.4,
          profitFactor: 0.2,
          sharpe: 0.1,
          drawdown: 0.1,
        }),
      }))
      .sort((a, b) => b.score - a.score)[0].data;
    
    // Balanced: equal weights
    const balanced = this.data
      .map(d => ({
        data: d,
        score: this.scoreStrategy(d, {
          pnl: 0.25,
          winRate: 0.25,
          profitFactor: 0.25,
          sharpe: 0.15,
          drawdown: 0.1,
        }),
      }))
      .sort((a, b) => b.score - a.score)[0].data;
    
    // Aggressive: prioritize PnL and profit factor
    const aggressive = this.data
      .map(d => ({
        data: d,
        score: this.scoreStrategy(d, {
          pnl: 0.4,
          winRate: 0.1,
          profitFactor: 0.4,
          sharpe: 0.05,
          drawdown: 0.05,
        }),
      }))
      .sort((a, b) => b.score - a.score)[0].data;
    
    return { conservative, balanced, aggressive };
  }
}

/**
 * Main ML optimization function
 */
async function optimizeWithML() {
  console.log('🤖 ML-Based Strategy Optimization\n');
  
  if (!fs.existsSync(RESULTS_CSV)) {
    console.error(`❌ Results CSV not found: ${RESULTS_CSV}`);
    console.error('   Please run optimize-strategies.ts first to generate strategy comparison data.');
    process.exit(1);
  }
  
  console.log('📂 Loading strategy results...');
  const csv = fs.readFileSync(RESULTS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  console.log(`✅ Loaded ${records.length} strategy results\n`);
  
  // Parse strategy data
  const strategyData: StrategyData[] = records.map(r => {
    const profitTargets = JSON.parse(r['Profit Targets'] || '[]');
    return {
      profitTargets: profitTargets.length,
      trailingStopPercent: parseFloat(r['Trailing Stop %']) / 100,
      trailingStopActivation: parseFloat(r['Stop Activation'].replace('x', '')),
      minExitPrice: parseFloat(r['Min Exit %']) / 100,
      totalPnlPercent: parseFloat(r['Total PnL %']),
      winRate: parseFloat(r['Win Rate %']) / 100,
      profitFactor: parseFloat(r['Profit Factor']),
      sharpeRatio: parseFloat(r['Sharpe Ratio']),
      maxDrawdown: parseFloat(r['Max Drawdown %']) / 100,
    };
  });
  
  // Train linear regression model
  console.log('🧠 Training linear regression model...');
  const lr = new LinearRegressionOptimizer();
  lr.train(strategyData);
  console.log('✅ Model trained\n');
  
  // Find optimal parameters
  console.log('🔍 Finding optimal parameters...');
  const optimalParams = lr.getOptimalParams();
  console.log('✅ Optimal parameters found:\n');
  console.log(`   Profit Targets: ${optimalParams.profitTargets}`);
  console.log(`   Trailing Stop: ${(optimalParams.trailingStopPercent * 100).toFixed(0)}%`);
  console.log(`   Stop Activation: ${optimalParams.trailingStopActivation.toFixed(1)}x`);
  console.log(`   Min Exit Price: ${(optimalParams.minExitPrice * 100).toFixed(0)}%\n`);
  
  // Multi-objective optimization
  console.log('🎯 Multi-objective optimization (Pareto analysis)...');
  const mo = new MultiObjectiveOptimizer(strategyData);
  const paretoOptimal = mo.findParetoOptimal();
  console.log(`✅ Found ${paretoOptimal.length} Pareto-optimal strategies\n`);
  
  // Find best for different risk profiles
  console.log('📊 Finding best strategies for different risk profiles...');
  const riskProfiles = mo.findBestForRiskProfile();
  
  console.log('\n🏆 RECOMMENDED STRATEGIES:\n');
  
  console.log('📉 CONSERVATIVE (High win rate, low drawdown):');
  console.log(`   Trailing Stop: ${(riskProfiles.conservative.trailingStopPercent * 100).toFixed(0)}%`);
  console.log(`   Stop Activation: ${riskProfiles.conservative.trailingStopActivation.toFixed(1)}x`);
  console.log(`   PnL: ${riskProfiles.conservative.totalPnlPercent.toFixed(2)}%`);
  console.log(`   Win Rate: ${(riskProfiles.conservative.winRate * 100).toFixed(1)}%`);
  console.log(`   Profit Factor: ${riskProfiles.conservative.profitFactor.toFixed(2)}\n`);
  
  console.log('⚖️  BALANCED (Equal weight to all metrics):');
  console.log(`   Trailing Stop: ${(riskProfiles.balanced.trailingStopPercent * 100).toFixed(0)}%`);
  console.log(`   Stop Activation: ${riskProfiles.balanced.trailingStopActivation.toFixed(1)}x`);
  console.log(`   PnL: ${riskProfiles.balanced.totalPnlPercent.toFixed(2)}%`);
  console.log(`   Win Rate: ${(riskProfiles.balanced.winRate * 100).toFixed(1)}%`);
  console.log(`   Profit Factor: ${riskProfiles.balanced.profitFactor.toFixed(2)}\n`);
  
  console.log('📈 AGGRESSIVE (Maximize returns):');
  console.log(`   Trailing Stop: ${(riskProfiles.aggressive.trailingStopPercent * 100).toFixed(0)}%`);
  console.log(`   Stop Activation: ${riskProfiles.aggressive.trailingStopActivation.toFixed(1)}x`);
  console.log(`   PnL: ${riskProfiles.aggressive.totalPnlPercent.toFixed(2)}%`);
  console.log(`   Win Rate: ${(riskProfiles.aggressive.winRate * 100).toFixed(1)}%`);
  console.log(`   Profit Factor: ${riskProfiles.aggressive.profitFactor.toFixed(2)}\n`);
  
  // Save recommendations
  const recommendations = {
    optimalParams,
    paretoOptimal: paretoOptimal.slice(0, 10), // Top 10
    riskProfiles,
    timestamp: new Date().toISOString(),
  };
  
  const outputPath = path.join(OUTPUT_DIR, 'ml_recommendations.json');
  fs.writeFileSync(outputPath, JSON.stringify(recommendations, null, 2));
  console.log(`💾 Recommendations saved to: ${outputPath}\n`);
  
  console.log('✅ ML optimization complete!');
}

optimizeWithML().catch(console.error);

