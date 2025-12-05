// Background job to compute dashboard metrics from pre-computed strategy results
import { dbManager } from '@/lib/db-manager';
import { dashboardMetricsDb, DashboardMetrics } from './dashboard-metrics-db';
import { strategyResultsDb } from './strategy-results-db';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import * as path from 'path';
import * as fs from 'fs';

// Resolve exports directory - handle both web/ and root execution contexts
// Try multiple possible paths
const getExportsDir = () => {
  const cwd = process.cwd();
  const possiblePaths = [
    path.join(cwd, 'data', 'exports'), // If running from root
    path.join(cwd, '..', 'data', 'exports'), // If running from web/
    path.join(__dirname, '..', '..', '..', 'data', 'exports'), // From compiled JS location
  ];
  
  for (const possiblePath of possiblePaths) {
    const absPath = path.resolve(possiblePath);
    if (fs.existsSync(absPath)) {
      return absPath;
    }
  }
  
  // Default fallback
  return path.join(cwd, '..', 'data', 'exports');
};
const EXPORTS_DIR = getExportsDir();

export class DashboardComputeJob {
  async run(): Promise<DashboardMetrics> {
    const db = await dbManager.getDatabase();
    const get = promisify(db.get.bind(db));
    const all = promisify(db.all.bind(db));

    // Define Brook's top strategy file path once at the top
    const brookTopStrategyFile = path.join(EXPORTS_DIR, 'solana-callers-optimized', '2025-11-24_17-32-21', 'Brook', 'MultiTrade_10pctTrail_50pctDropRebound_24h_trades.csv');

    // Total calls
    const totalCallsResult = await get('SELECT COUNT(*) as count FROM caller_alerts') as { count: number };
    const totalCalls = totalCallsResult?.count || 0;

    // Get all strategy results (if table exists)
    let allResults: any[] = [];
    try {
      const strategyDb = await strategyResultsDb.getDatabase();
      const strategyAll = promisify(strategyDb.all.bind(strategyDb));
      allResults = await strategyAll(
        `SELECT * FROM strategy_results ORDER BY alert_timestamp ASC`
      ) as any[];
    } catch (error: any) {
      // Table doesn't exist yet - that's okay, we'll compute with what we have
      console.log('[DashboardComputeJob] strategy_results table not available yet, computing basic metrics');
    }

    // Calculate PNL from all results
    // PNL is stored as a multiplier (1.128920 = 12.89% gain)
    // Assuming $100 per trade, calculate total PNL
    let pnlFromAlerts = 0;
    if (allResults.length > 0) {
      const totalPnl = allResults.reduce((sum, r) => sum + (r.pnl - 1.0), 0);
      pnlFromAlerts = totalPnl * 100; // $100 per trade
    }

    // Calculate current daily profit (today's trades)
    let currentDailyProfit = 0;
    let lastWeekDailyProfit = 0;
    
    if (allResults.length > 0) {
      const today = DateTime.now().startOf('day');
      const todayResults = allResults.filter(r => {
        try {
          const tradeDate = DateTime.fromISO(r.alert_timestamp);
          return tradeDate >= today;
        } catch {
          return false;
        }
      });
      if (todayResults.length > 0) {
        const todayPnl = todayResults.reduce((sum, r) => sum + (r.pnl - 1.0), 0);
        currentDailyProfit = (todayPnl / todayResults.length) * 100;
      }

      // Calculate last week daily profit (average per day)
      const oneWeekAgo = DateTime.now().minus({ days: 7 });
      const weekResults = allResults.filter(r => {
        try {
          const tradeDate = DateTime.fromISO(r.alert_timestamp);
          return tradeDate >= oneWeekAgo;
        } catch {
          return false;
        }
      });
      if (weekResults.length > 0) {
        const weekPnl = weekResults.reduce((sum, r) => sum + (r.pnl - 1.0), 0);
        lastWeekDailyProfit = (weekPnl / weekResults.length) * 100; // Average per trade, not per day
      }
    }

    // Find largest individual gain
    let largestGain = 0;
    if (allResults.length > 0) {
      const maxGainResult = allResults.reduce((max, r) => 
        r.max_reached > max.max_reached ? r : max
      );
      largestGain = (maxGainResult.max_reached - 1) * 100;
    }

    // Calculate max drawdown from all results
    let maxDrawdown = 0;
    if (allResults.length > 0) {
      let portfolio = 100;
      let peak = portfolio;
      let maxDrawdownValue = 0;

      for (const result of allResults) {
        const tradeReturn = result.pnl - 1.0;
        portfolio = portfolio * (1 + tradeReturn * 0.1); // Assume 10% position size
        if (portfolio > peak) peak = portfolio;
        const drawdown = (peak - portfolio) / peak;
        if (drawdown > maxDrawdownValue) {
          maxDrawdownValue = drawdown;
        }
      }
      maxDrawdown = maxDrawdownValue * 100;
    }

    // Calculate overall profit from Brook's top strategy
    // Strategy: MultiTrade_10pctTrail_50pctDropRebound_24h
    let overallProfit = 0;
    
    if (fs.existsSync(brookTopStrategyFile)) {
      try {
        const csvContent = fs.readFileSync(brookTopStrategyFile, 'utf8');
        const lines = csvContent.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const header = lines[0].toLowerCase().split(',');
          const pnlIdx = header.findIndex(h => h === 'pnl');
          
          if (pnlIdx >= 0) {
            let portfolio = 100.0; // Start with 100
            const positionSizePercent = 0.10; // 10% (based on 20% loss clamp: 2% max risk / 20% loss clamp = 10% position size)
            
            // Process all trades chronologically
            for (let i = 1; i < lines.length; i++) {
              const row = lines[i].split(',');
              if (row.length <= pnlIdx) continue;
              
              const pnl = parseFloat(row[pnlIdx]);
              if (isNaN(pnl)) continue;
              
              // Position size is a percentage of current portfolio (compounding)
              const positionSize = portfolio * positionSizePercent;
              const tradeReturn = (pnl - 1.0) * positionSize;
              portfolio = portfolio + tradeReturn;
            }
            
            overallProfit = ((portfolio / 100) - 1) * 100;
            console.log('[DashboardComputeJob] Brook top strategy overall profit:', overallProfit.toFixed(2) + '%');
          }
        }
      } catch (error) {
        console.error('[DashboardComputeJob] Error reading Brook top strategy file:', error);
      }
    }
    
    // Fallback: use weighted portfolio file if Brook strategy file not found
    const weightedPerfFile = path.join(EXPORTS_DIR, 'tenkan-kijun-remaining-period-by-caller', 'weighted_portfolio_performance_solana_only.json');
    
    if (overallProfit === 0 && fs.existsSync(weightedPerfFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(weightedPerfFile, 'utf8'));
        if (data.finalPortfolio && data.initialPortfolio) {
          overallProfit = ((data.finalPortfolio / data.initialPortfolio) - 1) * 100;
          console.log('[DashboardComputeJob] Overall profit from weighted portfolio file:', overallProfit.toFixed(2) + '%');
        }
      } catch (error) {
        console.error('[DashboardComputeJob] Error reading weighted portfolio file:', error);
      }
    } else if (overallProfit === 0) {
      console.warn('[DashboardComputeJob] Brook top strategy file not found:', brookTopStrategyFile);
      console.warn('[DashboardComputeJob] EXPORTS_DIR:', EXPORTS_DIR);
    }
    
    // Fallback: Calculate compounded portfolio growth from all results
    // NOTE: This fallback uses different data (strategy_results table) and may not match the weighted portfolio file
    if (overallProfit === 0 && allResults.length > 0) {
      console.log('[DashboardComputeJob] Using fallback calculation from', allResults.length, 'strategy results');
      let portfolio = 100; // Match the initial portfolio from weighted file
      for (const result of allResults) {
        const tradeReturn = (result.pnl - 1.0) * 0.1; // 10% position size
        portfolio = portfolio * (1 + tradeReturn); // Reinvest gains
      }
      overallProfit = ((portfolio / 100) - 1) * 100;
      console.log('[DashboardComputeJob] Fallback overall profit:', overallProfit.toFixed(2) + '%');
    }

    // Get profit since October 1st using Brook's top strategy
    // Strategy: MultiTrade_10pctTrail_50pctDropRebound_24h
    // Reuse brookTopStrategyFile defined above
    let profitSinceOctober = 0;
    
    if (fs.existsSync(brookTopStrategyFile)) {
      try {
        // Read Brook's top strategy trades
        const csvContent = fs.readFileSync(brookTopStrategyFile, 'utf8');
        const lines = csvContent.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const header = lines[0].toLowerCase().split(',');
          const alertTimeIdx = header.findIndex(h => h.includes('alert') && h.includes('time'));
          const pnlIdx = header.findIndex(h => h === 'pnl');
          
          if (alertTimeIdx >= 0 && pnlIdx >= 0) {
            const october1_2025 = DateTime.fromISO('2025-10-01');
            let portfolio = 100.0; // Start with 100
            let portfolioOnOct1 = 100.0; // Portfolio value at Oct 1st
            let foundOct1 = false;
            const positionSizePercent = 0.10; // 10% (based on 20% loss clamp: 2% max risk / 20% loss clamp = 10% position size)
            
            // Process all trades chronologically
            for (let i = 1; i < lines.length; i++) {
              const row = lines[i].split(',');
              if (row.length <= Math.max(alertTimeIdx, pnlIdx)) continue;
              
              const alertTimeStr = row[alertTimeIdx];
              const pnl = parseFloat(row[pnlIdx]);
              
              if (isNaN(pnl) || !alertTimeStr) continue;
              
              try {
                const alertTime = DateTime.fromISO(alertTimeStr);
                if (!alertTime.isValid) continue;
                
                // Calculate portfolio value before this trade
                const portfolioBefore = portfolio;
                
                // Position size is a percentage of current portfolio (compounding)
                const positionSize = portfolio * positionSizePercent;
                const tradeReturn = (pnl - 1.0) * positionSize;
                portfolio = portfolio + tradeReturn;
                
                // Track portfolio value at Oct 1st
                if (!foundOct1 && alertTime >= october1_2025) {
                  // Use the portfolio value just before Oct 1st trades
                  portfolioOnOct1 = portfolioBefore;
                  foundOct1 = true;
                }
              } catch (error) {
                // Skip invalid dates
                continue;
              }
            }
            
            // Calculate profit since October
            if (foundOct1 && portfolioOnOct1 > 0) {
              profitSinceOctober = ((portfolio / portfolioOnOct1) - 1) * 100;
            } else if (portfolio > 0) {
              // If no Oct 1st found, use cumulative from start
              profitSinceOctober = ((portfolio / 100) - 1) * 100;
            }
            
            console.log('[DashboardComputeJob] Brook top strategy profit since Oct:', profitSinceOctober.toFixed(2) + '%');
          }
        }
      } catch (error) {
        console.error('[DashboardComputeJob] Error reading Brook top strategy file:', error);
      }
    }
    
    // Fallback: use portfolio history if Brook strategy file not found
    const portfolioHistoryFile = path.join(EXPORTS_DIR, 'tenkan-kijun-remaining-period-by-caller', 'weighted_portfolio_history_solana_only.csv');
    const weightedPerfFileForOct = path.join(EXPORTS_DIR, 'tenkan-kijun-remaining-period-by-caller', 'weighted_portfolio_performance_solana_only.json');
    
    if (profitSinceOctober === 0 && fs.existsSync(portfolioHistoryFile) && fs.existsSync(weightedPerfFileForOct)) {
      try {
        // Get final portfolio value
        const perfData = JSON.parse(fs.readFileSync(weightedPerfFileForOct, 'utf8'));
        const finalPortfolio = perfData.finalPortfolio;
        
        // Find portfolio value on Oct 1st from history
        const csvContent = fs.readFileSync(portfolioHistoryFile, 'utf8');
        const lines = csvContent.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const header = lines[0].toLowerCase().split(',');
          const dateIdx = header.findIndex(h => h.includes('date'));
          const portfolioIdx = header.findIndex(h => h.includes('portfolio'));
          
          if (dateIdx >= 0 && portfolioIdx >= 0) {
            // Try 2025 first, then 2024 as fallback
            const october1_2025 = DateTime.fromISO('2025-10-01');
            const october1_2024 = DateTime.fromISO('2024-10-01');
            let portfolioOnOct1 = null;
            
            // Find the portfolio value on or just before Oct 1st (try 2025 first)
            for (let i = 1; i < lines.length; i++) {
              const row = lines[i].split(',');
              const rowDate = DateTime.fromISO(row[dateIdx]);
              if (rowDate.isValid && rowDate >= october1_2025) {
                // Found first entry on or after Oct 1st, 2025
                // If it's exactly Oct 1st, use it; otherwise use previous row
                if (i > 1 && rowDate > october1_2025) {
                  const prevRow = lines[i - 1].split(',');
                  portfolioOnOct1 = parseFloat(prevRow[portfolioIdx]);
                } else {
                  portfolioOnOct1 = parseFloat(row[portfolioIdx]);
                }
                break;
              }
            }
            
            // If not found for 2025, try 2024
            if (portfolioOnOct1 === null) {
              for (let i = 1; i < lines.length; i++) {
                const row = lines[i].split(',');
                const rowDate = DateTime.fromISO(row[dateIdx]);
                if (rowDate.isValid && rowDate >= october1_2024) {
                  // Found first entry on or after Oct 1st, 2024
                  if (i > 1 && rowDate > october1_2024) {
                    const prevRow = lines[i - 1].split(',');
                    portfolioOnOct1 = parseFloat(prevRow[portfolioIdx]);
                  } else {
                    portfolioOnOct1 = parseFloat(row[portfolioIdx]);
                  }
                  break;
                }
              }
            }
            
            // If still not found, use the first available date in the history (earliest portfolio value)
            if (portfolioOnOct1 === null && lines.length > 1) {
              // Find the first valid portfolio value
              for (let i = 1; i < lines.length; i++) {
                const row = lines[i].split(',');
                const portfolioValue = parseFloat(row[portfolioIdx]);
                if (!isNaN(portfolioValue) && portfolioValue > 0) {
                  portfolioOnOct1 = portfolioValue;
                  break;
                }
              }
            }
            
            // Last resort: use initial portfolio from JSON
            if (portfolioOnOct1 === null && perfData.initialPortfolio) {
              portfolioOnOct1 = perfData.initialPortfolio;
            }
            
            if (portfolioOnOct1 && portfolioOnOct1 > 0 && finalPortfolio) {
              profitSinceOctober = ((finalPortfolio / portfolioOnOct1) - 1) * 100;
            }
          }
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }
    
    // Fallback: calculate from strategy results if portfolio history not found
    if (profitSinceOctober === 0 && allResults.length > 0) {
      // Try 2025 first, then 2024 as fallback
      const october1_2025 = DateTime.fromISO('2025-10-01');
      const october1_2024 = DateTime.fromISO('2024-10-01');
      let octoberResults = allResults.filter(r => {
        try {
          const tradeDate = DateTime.fromISO(r.alert_timestamp);
          return tradeDate >= october1_2025;
        } catch {
          return false;
        }
      });
      
      // If no results for 2025, try 2024
      if (octoberResults.length === 0) {
        octoberResults = allResults.filter(r => {
          try {
            const tradeDate = DateTime.fromISO(r.alert_timestamp);
            return tradeDate >= october1_2024;
          } catch {
            return false;
          }
        });
      }
      
      if (octoberResults.length > 0) {
        // Calculate weighted portfolio performance
        // Use same initial portfolio as overall (100) for consistency
        let portfolio = 100;
        for (const result of octoberResults) {
          const tradeReturn = (result.pnl - 1.0) * 0.1; // 10% position size
          portfolio = portfolio * (1 + tradeReturn);
        }
        profitSinceOctober = ((portfolio / 100) - 1) * 100;
      }
    }

    const metrics: DashboardMetrics = {
      computed_at: new Date().toISOString(),
      total_calls: totalCalls,
      pnl_from_alerts: pnlFromAlerts,
      max_drawdown: maxDrawdown,
      current_daily_profit: currentDailyProfit,
      last_week_daily_profit: lastWeekDailyProfit,
      overall_profit: overallProfit,
      largest_gain: largestGain,
      profit_since_october: profitSinceOctober,
    };

    await dashboardMetricsDb.saveMetrics(metrics);
    return metrics;
  }
}

