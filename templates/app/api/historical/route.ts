import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import type { HistoricalAlert } from "@/lib/types"
import { fetchTokenMetadata } from "@/lib/birdeye-metadata"

async function loadHistoricalAlerts(): Promise<HistoricalAlert[]> {
  try {
    // Path from templates/ to quantBot/data/exports/csv
    const csvDir = path.join(process.cwd(), "..", "data", "exports", "csv")
    const files = await fs.readdir(csvDir)
    const tradeFiles = files.filter(f => f.endsWith("_trade_by_trade.csv"))
    
    const allAlerts: HistoricalAlert[] = []
    
    // Collect all unique token addresses first to batch fetch metadata
    const tokenAddresses = new Set<string>()
    const metadataMap = new Map<string, { name: string; symbol: string }>()
    
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
        
        const tokenAddress = record["TokenAddress"] || ""
        const tokenSymbol = record["TokenSymbol"] || ""
        const tokenName = record["TokenName"] || ""
        
        if (tokenAddress) {
          // Pre-populate metadata from CSV if available
          if (tokenSymbol && tokenSymbol !== "UNKNOWN" && tokenName) {
            metadataMap.set(tokenAddress, {
              name: tokenName,
              symbol: tokenSymbol
            })
          } else {
            // Only fetch from API if not in CSV
            tokenAddresses.add(tokenAddress)
          }
        }
      }
    }
    
    // Batch fetch metadata for tokens not in CSV
    console.log(`Fetching metadata for ${tokenAddresses.size} tokens from API (${metadataMap.size} already loaded from CSV)...`)
    
    for (const tokenAddress of tokenAddresses) {
      // Skip if already in map from CSV
      if (metadataMap.has(tokenAddress)) continue
      
      try {
        const metadata = await fetchTokenMetadata(tokenAddress, "solana")
        if (metadata) {
          metadataMap.set(tokenAddress, {
            name: metadata.name,
            symbol: metadata.symbol
          })
        }
        // Rate limiting is handled in fetchTokenMetadata
      } catch (error) {
        // Errors are handled gracefully in fetchTokenMetadata
      }
    }
    
    console.log(`Total metadata available: ${metadataMap.size} tokens`)
    
    // Now process all trades
    for (const file of tradeFiles) {
      const filePath = path.join(csvDir, file)
      const content = await fs.readFile(filePath, "utf8")
      const lines = content.trim().split("\n")
      
      if (lines.length < 2) continue
      
      const headers = lines[0].split(",").map(h => h.trim())
      const callerName = file.replace("_trade_by_trade.csv", "").replace(/_/g, " ")
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim())
        if (values.length < headers.length) continue
        
        const record: Record<string, string> = {}
        headers.forEach((header, idx) => {
          record[header] = values[idx] || ""
        })
        
        const tradeNum = parseInt(record["Trade#"] || "0")
        const date = record["Date"] || ""
        const time = record["Time"] || ""
        const tokenAddress = record["TokenAddress"] || ""
        const tokenSymbol = record["TokenSymbol"] || ""
        const tokenName = record["TokenName"] || ""
        const chainRaw = record["Chain"] || "solana"
        const investment = parseFloat(record["Investment_SOL"] || "0")
        const pnlMultiplier = parseFloat(record["PNL_Multiplier"] || "0")
        const returnSol = parseFloat(record["Return_SOL"] || "0")
        const maxReached = parseFloat(record["Max_Multiplier_Reached"] || "0")
        const holdDuration = parseFloat(record["HoldDuration_Minutes"] || "0")
        const timeToAth = parseFloat(record["TimeToAth_Minutes"] || "0")
        
        if (!date || !tokenAddress || investment === 0) continue
        
        // Format chain name
        const chainMap: Record<string, string> = {
          'solana': 'SOL',
          'ethereum': 'ETH',
          'bsc': 'BNC',
          'base': 'BASE',
          'arbitrum': 'ARB'
        }
        const chain = chainMap[chainRaw.toLowerCase()] || chainRaw.toUpperCase()
        
        // Use CSV metadata if available, otherwise fall back to metadataMap
        const metadata = (tokenSymbol && tokenSymbol !== "UNKNOWN" && tokenName)
          ? { name: tokenName, symbol: tokenSymbol }
          : metadataMap.get(tokenAddress)
        
        // Calculate PNL percentage
        const pnlPercent = (pnlMultiplier - 1) * 100
        
        // Parse timestamp
        const timestamp = new Date(`${date}T${time}Z`)
        if (isNaN(timestamp.getTime())) continue
        
        // Determine status
        let status: "active" | "closed" | "stopped" = "closed"
        if (pnlMultiplier < 0.7) {
          status = "stopped"
        } else if (pnlMultiplier > 1.0) {
          status = "closed"
        }
        
        // Calculate entry and exit prices for display
        // We don't have actual token prices, so we'll derive them from investment and return
        // entryPrice = investment / tokenAmount, exitPrice = returnAmount / tokenAmount
        // Since tokenAmount is unknown, we estimate based on a reasonable token price range
        // For tokens with high multipliers, use a lower base price to show realistic scaling
        const basePrice = pnlMultiplier > 100 ? 0.001 : (pnlMultiplier > 10 ? 0.01 : 0.1)
        const entryPrice = basePrice
        const exitPrice = basePrice * pnlMultiplier
        
        // Calculate max drawdown (simplified - use max reached vs final)
        const maxDrawdown = maxReached > 0 && pnlMultiplier < maxReached 
          ? ((maxReached - pnlMultiplier) / maxReached) * 100 
          : undefined
        
        const alert: HistoricalAlert = {
          id: `historical-${callerName}-${tradeNum}-${tokenAddress.substring(0, 8)}`,
          timestamp: timestamp,
          creator: callerName,
          token: metadata?.name || `Token ${tokenAddress.substring(0, 8)}`,
          tokenSymbol: metadata?.symbol || tokenAddress.substring(0, 4).toUpperCase(),
          tokenAddress: tokenAddress,
          action: chain as any, // Use chain instead of "buy"
          confidence: 0.85,
          entryPrice: entryPrice,
          currentPrice: exitPrice,
          exitPrice: exitPrice,
          status: status,
          pnl: pnlPercent,
          pnlPercent: pnlPercent,
          maxDrawdown: maxDrawdown,
          volumeSOL: investment,
          holdDuration: holdDuration > 0 ? holdDuration : undefined,
          timeToAth: timeToAth > 0 ? timeToAth : undefined,
          closedAt: timestamp, // Assume closed at trade time
        }
        
        allAlerts.push(alert)
      }
    }
    
    // Sort by timestamp descending
    allAlerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    
    return allAlerts
  } catch (error) {
    console.error("Error loading historical alerts:", error)
    return []
  }
}

export async function GET() {
  const historical = await loadHistoricalAlerts()
  return NextResponse.json(historical)
}
