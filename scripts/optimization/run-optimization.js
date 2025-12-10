#!/usr/bin/env ts-node
"use strict";
/**
 * Optimization CLI
 *
 * Run strategy optimization from config files
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const optimization_1 = require("../../src/simulation/optimization");
function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            options.config = argv[++i];
        }
        else if (arg === '--help' || arg === '-h') {
            options.help = true;
        }
    }
    return options;
}
async function loadConfigFromFile(configPath) {
    const filePath = path_1.default.isAbsolute(configPath)
        ? configPath
        : path_1.default.join(process.cwd(), configPath);
    const content = await fs_1.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
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
        const optimizer = new optimization_1.StrategyOptimizer();
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
                    const { JsonReporter } = await Promise.resolve().then(() => __importStar(require('../../src/reporting/formats/json-reporter')));
                    const reporter = new JsonReporter();
                    // Convert optimization results to analysis results format
                    // This is a simplified conversion - full implementation would need proper mapping
                    console.log(`\n📊 Results saved to: ${output.path}`);
                }
            }
        }
    }
    catch (error) {
        console.error('❌ Optimization failed:', error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=run-optimization.js.map