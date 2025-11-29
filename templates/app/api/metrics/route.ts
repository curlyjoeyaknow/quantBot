import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import type { KPIMetrics } from "@/lib/types"

async function loadAllTradeData(): Promise<Array<{
  date: string
  pnlMultiplier: number
  investment: number
  returnAmount: number
  profit: number
  maxReached: number
  callerName: string
  portfolioAfter: number
}>> {
  try {
    const csvDir = path.join(process.cwd(), "..", "data", "exports", "csv")
    const files = await fs.readdir(csvDir)
    const tradeFiles = files.filter(f => f.endsWith("_trade_by_trade.csv"))
    
    const allTrades: Array<{
      date: string
      pnlMultiplier: number
      investment: number
      returnAmount: number
      profit: number
      maxReached: number
      callerName: string
      portfolioAfter: number
    }> = []
    
    for (const file of tradeFiles) {
      const filePath = path.join(csvDir, file)
      const content = await fs.readFile(filePath, "utf8")
      const lines = content.trim().split("\n")
      
      if (lines.length < 2) continue
      
      const headers = lines[0].split(",").map(h => h.trim())
      const callerName = file.replace("_trade_by_trade.csv", "").replace(/_/g, " ")
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ''))
        if (values.length < headers.length) continue
        
        const record: Record<string, string> = {}
        headers.forEach((header, idx) => {
          record[header] = values[idx] || ""
        })
        
        const date = record["Date"] || ""
        const investment = parseFloat(record["Investment_SOL"] || "0")
        const pnlMultiplier = parseFloat(record["PNL_Multiplier"] || "0")
        const returnAmount = parseFloat(record["Return_SOL"] || "0")
        const profit = parseFloat(record["Profit_SOL"] || "0")
        const portfolioAfter = parseFloat(record["Portfolio_After_SOL"] || "0")
        const maxReached = parseFloat(record["Max_Multiplier_Reached"] || "0")
        
        if (!date || investment === 0) continue
        
        allTrades.push({
          date,
          pnlMultiplier,
          investment,
          returnAmount,
          profit,
          maxReached,
          callerName,
          portfolioAfter
        })
      }
    }
    
    return allTrades
  } catch (error) {
    console.error("Error loading trade data:", error)
    return []
  }
}

export async function GET() {
  try {
    // Load actual trade data from CSV files
    const allTrades = await loadAllTradeData()
    
    if (allTrades.length === 0) {
      // Fallback to alerts.json if no CSV data
      const { loadAlertsFromFile } = await import("@/lib/data-loader")
      const alerts = await loadAlertsFromFile()
      
      if (alerts.length === 0) {
        const { generateKPIMetrics } = await import("@/lib/mock-data")
  const metrics = generateKPIMetrics()
  return NextResponse.json(metrics)
      }
      
      // Calculate from alerts.json (fallback)
      const totalPnlPercent = alerts.length > 0 
        ? alerts.reduce((sum, alert) => sum + (alert.pnl || 0), 0) / alerts.length 
        : 0
      
      const totalPnlSol = alerts.reduce((sum, alert) => {
        const volume = alert.volumeSOL || 0
        const pnlPercent = alert.pnl || 0
        const profit = volume * (pnlPercent / 100)
        return sum + profit
      }, 0)
      
      const SOL_TO_USD = 150
      const totalPnl = totalPnlSol * SOL_TO_USD
      
      const winners = alerts.filter(a => (a.pnl || 0) > 0).length
      const signalAccuracy = alerts.length > 0 ? (winners / alerts.length) * 100 : 0
      
      const activeAlerts = alerts.filter(a => a.status === 'active').length
      const hitRatio = signalAccuracy
      const alphaVsMarket = totalPnlPercent * 0.8
      
      const metrics: KPIMetrics = {
        totalPnl,
        totalPnlPercent,
        signalAccuracy,
        activeAlerts,
        alphaVsMarket,
        avgTimeToAth: 0,
        hitRatio
      }
      
      return NextResponse.json(metrics)
    }
    
    // Calculate metrics from actual CSV trade data
    const totalTrades = allTrades.length
    
    // Get final portfolio values per caller (last trade portfolio_after for each caller)
    const callerFinalPortfolios = new Map<string, number>()
    
    // Group trades by caller and get the last portfolio_after value
    const tradesByCaller = new Map<string, typeof allTrades>()
    for (const trade of allTrades) {
      if (!tradesByCaller.has(trade.callerName)) {
        tradesByCaller.set(trade.callerName, [])
      }
      tradesByCaller.get(trade.callerName)!.push(trade)
    }
    
    // Each caller starts with 10 SOL, get final portfolio from last trade
    let totalStartPortfolio = 0
    let totalEndPortfolio = 0
    
    for (const [caller, trades] of tradesByCaller) {
      totalStartPortfolio += 10.0 // Each caller starts with 10 SOL
      if (trades.length > 0) {
        // Sort by date to get the actual last trade
        const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date))
        const lastTrade = sortedTrades[sortedTrades.length - 1]
        totalEndPortfolio += lastTrade.portfolioAfter
      } else {
        totalEndPortfolio += 10.0
      }
    }
    
    // Total PNL percentage (based on portfolio growth across all callers)
    const totalPnlPercent = totalStartPortfolio > 0
      ? ((totalEndPortfolio - totalStartPortfolio) / totalStartPortfolio) * 100
      : 0
    
    // Total PNL in SOL (portfolio growth, not sum of individual profits)
    const totalPnlSol = totalEndPortfolio - totalStartPortfolio
    
    // Convert to USD
    const SOL_TO_USD = 150
    const totalPnl = totalPnlSol * SOL_TO_USD
    
    // Signal accuracy (trades with PNL > 1.0)
    const winners = allTrades.filter(t => t.pnlMultiplier > 1.0).length
    const signalAccuracy = totalTrades > 0 ? (winners / totalTrades) * 100 : 0
    
    // Active alerts (trades that haven't completed - maxReached > 1.0 but pnl < 1.5)
    const activeAlerts = allTrades.filter(t => t.maxReached > 1.0 && t.pnlMultiplier < 1.5 && t.pnlMultiplier > 0.7).length
    
    // Hit ratio (same as signal accuracy)
    const hitRatio = signalAccuracy
    
    // Alpha vs market (simplified)
    const alphaVsMarket = totalPnlPercent * 0.8
    
    // Average time to ATH (we don't have this in CSV, so 0 for now)
    const avgTimeToAth = 0
    
    const metrics: KPIMetrics = {
      totalPnl,
      totalPnlPercent,
      signalAccuracy,
      activeAlerts,
      alphaVsMarket,
      avgTimeToAth,
      hitRatio
    }
    
    console.log(`Metrics calculated: ${totalTrades} trades, PNL: ${totalPnlPercent.toFixed(2)}%, Total PNL: $${totalPnl.toFixed(2)}`)
    
    return NextResponse.json(metrics)
  } catch (error) {
    console.error("Error calculating metrics:", error)
    // Fallback to mock data on error
    const { generateKPIMetrics } = await import("@/lib/mock-data")
    const metrics = generateKPIMetrics()
    return NextResponse.json(metrics)
  }
}
