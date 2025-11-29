import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import type { PerformanceDataPoint } from "@/lib/types"

async function loadPerformanceHistory(hours: number): Promise<PerformanceDataPoint[]> {
  try {
    // Path from templates/ to quantBot/data/exports/csv
    const csvDir = path.join(process.cwd(), "..", "data", "exports", "csv")
    const files = await fs.readdir(csvDir)
    const tradeFiles = files.filter(f => f.endsWith("_trade_by_trade.csv"))
    
    const allTrades: Array<{
      timestamp: Date
      pnlMultiplier: number
      investment: number
      portfolioAfter: number
    }> = []
    
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)
    
    for (const file of tradeFiles) {
      const filePath = path.join(csvDir, file)
      const content = await fs.readFile(filePath, "utf8")
      const lines = content.trim().split("\n")
      
      if (lines.length < 2) continue
      
      const headers = lines[0].split(",").map(h => h.trim())
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim())
        if (values.length < headers.length) continue
        
        const record: Record<string, string> = {}
        headers.forEach((header, idx) => {
          record[header] = values[idx] || ""
        })
        
        const date = record["Date"] || ""
        const time = record["Time"] || ""
        const investment = parseFloat(record["Investment_SOL"] || "0")
        const pnlMultiplier = parseFloat(record["PNL_Multiplier"] || "0")
        const portfolioAfter = parseFloat(record["Portfolio_After_SOL"] || "0")
        
        if (!date || investment === 0) continue
        
        const timestamp = new Date(`${date}T${time}Z`)
        if (isNaN(timestamp.getTime()) || timestamp < cutoffTime) continue
        
        allTrades.push({
          timestamp,
          pnlMultiplier,
          investment,
          portfolioAfter,
        })
      }
    }
    
    // Sort by timestamp
    allTrades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    
    // Group by time buckets (1 hour intervals)
    const bucketSize = 60 * 60 * 1000 // 1 hour
    const buckets = new Map<number, PerformanceDataPoint>()
    
    let cumulativePortfolio = 10.0 // Starting portfolio
    let activeSignals = 0
    
    for (const trade of allTrades) {
      const bucketTime = Math.floor(trade.timestamp.getTime() / bucketSize) * bucketSize
      
      // Calculate portfolio PNL at this point
      cumulativePortfolio = trade.portfolioAfter
      
      // Calculate PNL percentage from multiplier
      const tradePnl = (trade.pnlMultiplier - 1) * 100
      
      // Get or create bucket
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          timestamp: new Date(bucketTime),
          portfolioPnl: 0,
          marketPnl: 0, // We don't have market data
          alpha: 0,
          activeSignals: 0,
        })
      }
      
      const bucket = buckets.get(bucketTime)!
      bucket.portfolioPnl = ((cumulativePortfolio - 10.0) / 10.0) * 100
      bucket.activeSignals = Math.max(activeSignals, bucket.activeSignals)
      
      // Update active signals count (simplified - just count trades)
      activeSignals++
    }
    
    // Convert to array and fill gaps
    const result: PerformanceDataPoint[] = []
    const now = Date.now()
    const startTime = Math.floor((now - hours * 60 * 60 * 1000) / bucketSize) * bucketSize
    
    for (let time = startTime; time <= now; time += bucketSize) {
      if (buckets.has(time)) {
        result.push(buckets.get(time)!)
      } else {
        // Fill with previous value or zero
        const prevValue = result.length > 0 ? result[result.length - 1] : null
        result.push({
          timestamp: new Date(time),
          portfolioPnl: prevValue?.portfolioPnl || 0,
          marketPnl: 0,
          alpha: 0,
          activeSignals: prevValue?.activeSignals || 0,
        })
      }
    }
    
    return result
  } catch (error) {
    console.error("Error loading performance history:", error)
    return []
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const hours = Number.parseInt(searchParams.get("hours") || "24")

  const performance = await loadPerformanceHistory(hours)
  return NextResponse.json(performance)
}
