#!/usr/bin/env ts-node
/**
 * Modular Weekly Report Generator
 * 
 * Can be called with parameters to generate reports for different strategies,
 * date ranges, and configurations without modifying the script.
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { queryCandles } from '../storage/clickhouse-client';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || 'dec8084b90724ffe949b68d0a18359d6';

export interface ReportGeneratorOptions {
  // Strategy selection
  strategyType: 'tenkan-kijun' | 'optimized';
  strategyName?: string; // For optimized strategies
  simulationTimestamp?: string; // e.g., '2025-11-24_17-32-21'
  
  // Date range
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  
  // Caller filtering
  callers?: string[]; // If not provided, uses top 5 callers
  
  // Output
  outputDir?: string; // Default: data/exports/emails/weekly-reports
  
  // Options
  runSimulationsIfMissing?: boolean; // Run simulations for missing weeks
  chain?: 'solana' | 'all'; // Filter by chain
}

export interface ReportGenerationResult {
  success: boolean;
  reportsGenerated: number;
  outputDirectory: string;
  errors?: string[];
  warnings?: string[];
}

/**
 * Generate weekly reports based on provided options
 */
export async function generateWeeklyReports(options: ReportGeneratorOptions): Promise<ReportGenerationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let reportsGenerated = 0;
  
  try {
    // Validate options
    const startDate = DateTime.fromISO(options.startDate);
    const endDate = DateTime.fromISO(options.endDate);
    
    if (!startDate.isValid) {
      throw new Error(`Invalid startDate: ${options.startDate}`);
    }
    if (!endDate.isValid) {
      throw new Error(`Invalid endDate: ${options.endDate}`);
    }
    if (startDate > endDate) {
      throw new Error('startDate must be before endDate');
    }
    
    // Set defaults
    const outputDir = options.outputDir || path.join(__dirname, '../../data/exports/emails/weekly-reports');
    const chain = options.chain || 'solana';
    const runSimulationsIfMissing = options.runSimulationsIfMissing ?? false;
    
    // Determine strategy configuration
    let strategyConfig: {
      type: 'tenkan-kijun' | 'optimized';
      name: string;
      displayName: string;
      tradeHistoryPath: string;
      portfolioHistoryPath?: string;
    };
    
    if (options.strategyType === 'tenkan-kijun') {
      strategyConfig = {
        type: 'tenkan-kijun',
        name: 'Tenkan-Kijun Weighted Portfolio',
        displayName: 'Tenkan-Kijun (Weighted Portfolio)',
        tradeHistoryPath: path.join(__dirname, '../../data/exports/tenkan-kijun-remaining-period-by-caller'),
        portfolioHistoryPath: path.join(__dirname, '../../data/exports/tenkan-kijun-remaining-period-by-caller/weighted_portfolio_history_solana_only.csv'),
      };
    } else {
      if (!options.strategyName) {
        throw new Error('strategyName is required for optimized strategies');
      }
      if (!options.simulationTimestamp) {
        throw new Error('simulationTimestamp is required for optimized strategies');
      }
      
      strategyConfig = {
        type: 'optimized',
        name: options.strategyName,
        displayName: options.strategyName.replace(/_/g, ' '),
        tradeHistoryPath: path.join(__dirname, `../../data/exports/solana-callers-optimized/${options.simulationTimestamp}`),
      };
    }
    
    // Determine callers to use
    const topCallers = ['Brook', 'Brook Giga I verify @BrookCalls', 'meta_maxist', 'exy', 'Mistor'];
    const callers = options.callers || topCallers;
    
    // Generate weeks
    const weeks: DateTime[] = [];
    let currentWeek = startDate.startOf('week');
    const endWeek = endDate.startOf('week');
    
    while (currentWeek <= endWeek) {
      weeks.push(currentWeek);
      currentWeek = currentWeek.plus({ weeks: 1 });
    }
    
    // Load calls data
    const callsCsvPath = path.join(__dirname, '../../data/exports/csv/all_brook_channels_calls.csv');
    if (!fs.existsSync(callsCsvPath)) {
      throw new Error(`Calls CSV not found: ${callsCsvPath}`);
    }
    
    const csv = fs.readFileSync(callsCsvPath, 'utf8');
    const allCalls: any[] = await new Promise((resolve, reject) => {
      parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
    
    // Filter to chain
    const filteredCalls = allCalls.filter(r => {
      if (chain === 'all') return true;
      const callChain = (r.chain || 'solana').toLowerCase();
      return callChain === chain;
    });
    
    // Load template
    const templatePath = path.join(__dirname, '../../data/exports/emails/weekly-report-2025-11-06.html');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');
    template = fixTemplateMobileStyles(template);
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Process each week
    const allTrades: any[] = [];
    
    for (const weekStart of weeks) {
      const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
      const weekKey = weekStart.toFormat('yyyy-MM-dd');
      
      // Get calls for this week
      const weekCalls = filteredCalls.filter(call => {
        const timestamp = call.timestamp || call.alertTime;
        if (!timestamp) return false;
        const alertTime = DateTime.fromISO(timestamp);
        if (!alertTime.isValid) return false;
        const alertWeek = alertTime.startOf('week');
        return alertWeek.hasSame(weekStart, 'week');
      });
      
      // Load or generate trades for this week
      let weekTrades: any[] = [];
      
      if (strategyConfig.type === 'tenkan-kijun') {
        weekTrades = await loadTenkanKijunTradesForWeek(strategyConfig, weekStart, callers);
      } else {
        weekTrades = await loadOptimizedTradesForWeek(
          strategyConfig,
          weekCalls,
          weekStart,
          weekEnd,
          callers,
          runSimulationsIfMissing
        );
      }
      
      if (weekTrades.length > 0) {
        allTrades.push(...weekTrades);
      }
    }
    
    // Generate portfolio history
    const portfolioHistory = generateWeeklyPortfolioHistory(allTrades);
    
    // Generate reports for each week
    for (const weekStart of weeks) {
      const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
      const weekKey = weekStart.toFormat('yyyy-MM-dd');
      
      // Filter trades to only this week
      const weekTrades = allTrades.filter(t => {
        const alertWeek = t.alertTime.startOf('week');
        return alertWeek.hasSame(weekStart, 'week');
      });
      
      // Generate report HTML
      const reportHtml = await generateReportHtml(
        template,
        strategyConfig,
        portfolioHistory,
        weekTrades,
        weekStart,
        weekEnd
      );
      
      // Save report
      const strategySlug = strategyConfig.name.replace(/[^a-zA-Z0-9]/g, '_');
      const outputPath = path.join(outputDir, `${strategySlug}_${weekKey}.html`);
      fs.writeFileSync(outputPath, reportHtml);
      reportsGenerated++;
    }
    
    return {
      success: true,
      reportsGenerated,
      outputDirectory: outputDir,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    
  } catch (error: any) {
    errors.push(error.message || String(error));
    return {
      success: false,
      reportsGenerated,
      outputDirectory: options.outputDir || '',
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

// Helper functions (simplified versions - would need full implementation)
function fixTemplateMobileStyles(template: string): string {
  // Same implementation as in generate-strategy-weekly-reports.ts
  let html = template;
  
  let mediaQueryMatch;
  while ((mediaQueryMatch = html.match(/@media\s*\([^)]+\)\s*\{[\s\S]*?\}/)) !== null) {
    html = html.replace(mediaQueryMatch[0], '');
  }
  
  html = html.replace(/\.stats-grid\s*\{[^}]*\}/g, 
    `.stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 16px;
        }`);
  
  html = html.replace(/\.outcome-grid\s*\{[^}]*\}/g,
    `.outcome-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }`);
  
  html = html.replace(/\.price-grid\s*\{[^}]*\}/g,
    `.price-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 16px;
            padding-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }`);
  
  return html;
}

async function loadTenkanKijunTradesForWeek(
  strategyConfig: any,
  weekStart: DateTime,
  callers: string[]
): Promise<any[]> {
  // Implementation would load from Tenkan-Kijun trade files
  // This is a placeholder
  return [];
}

async function loadOptimizedTradesForWeek(
  strategyConfig: any,
  weekCalls: any[],
  weekStart: DateTime,
  weekEnd: DateTime,
  callers: string[],
  runSimulationsIfMissing: boolean
): Promise<any[]> {
  // Implementation would load from optimized strategy files
  // This is a placeholder
  return [];
}

function generateWeeklyPortfolioHistory(trades: any[]): any[] {
  // Implementation would generate portfolio history
  // This is a placeholder
  return [];
}

async function generateReportHtml(
  template: string,
  strategyConfig: any,
  portfolioHistory: any[],
  weekTrades: any[],
  weekStart: DateTime,
  weekEnd: DateTime
): Promise<string> {
  // Implementation would generate the HTML report
  // This is a placeholder
  return template;
}

