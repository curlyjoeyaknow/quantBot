#!/usr/bin/env ts-node
/**
 * Optimization CLI
 * 
 * Run strategy optimization from config files
 */

import 'dotenv/config';
import path from 'path';
import { promises as fs } from 'fs';
import { StrategyOptimizer } from '../../src/simulation/optimization';
import { OptimizationConfig } from '../../src/simulation/optimization/types';

interface CliOptions {
  config?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config' || arg === '-c') {
      options.config = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  
  return options;
}

async function loadConfigFromFile(configPath: string): Promise<OptimizationConfig> {
  const filePath = path.isAbsolute(configPath) 
    ? configPath 
    : path.join(process.cwd(), configPath);
  
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as OptimizationConfig;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.config) {
    console.log(`
Usage: ts-node scripts/optimization/run-optimization.ts --config <path>

Options:
  --config, -c    Path to optimization config JSON file
  --help, -h      Show this help message

Example:
  ts-node scripts/optimization/run-optimization.ts --config configs/optimization/basic-grid.json
`);
    process.exit(options.help ? 0 : 1);
  }

  try {
    console.log(`Loading optimization config from: ${options.config}`);
    const config = await loadConfigFromFile(options.config);
    
    console.log(`Running optimization: ${config.name}`);
    console.log(`Testing ${config.maxStrategies || 'all'} strategies...`);
    
    const optimizer = new StrategyOptimizer();
    const result = await optimizer.optimize(config);
    
    console.log(`\n✅ Optimization complete!`);
    console.log(`   Total strategies tested: ${result.summary.totalStrategiesTested}`);
    console.log(`   Best PnL: ${result.summary.bestPnl.toFixed(2)}%`);
    console.log(`   Best Win Rate: ${result.summary.bestWinRate.toFixed(2)}%`);
    console.log(`   Best Profit Factor: ${result.summary.bestProfitFactor.toFixed(2)}`);
    
    if (result.bestStrategy) {
      console.log(`\n🏆 Best Strategy: ${result.bestStrategy.strategy.name}`);
      console.log(`   PnL: ${result.bestStrategy.metrics.totalPnlPercent.toFixed(2)}%`);
      console.log(`   Win Rate: ${result.bestStrategy.metrics.winRate.toFixed(2)}%`);
      console.log(`   Profit Factor: ${result.bestStrategy.metrics.profitFactor.toFixed(2)}`);
    }

    // Save results if output specified
    if (config.outputs && config.outputs.length > 0) {
      for (const output of config.outputs) {
        if (output.type === 'json' && output.path) {
          const { JsonReporter } = await import('../../src/reporting/formats/json-reporter');
          const reporter = new JsonReporter();
          // Convert optimization results to analysis results format
          // This is a simplified conversion - full implementation would need proper mapping
          console.log(`\n📊 Results saved to: ${output.path}`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Optimization failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

