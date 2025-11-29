export type AlertStatus = "active" | "closed" | "stopped"
export type AlertAction = "buy" | "sell" | "SOL" | "ETH" | "BNC" | "BASE" | "ARB" | string

export interface Alert {
  id: string
  timestamp: Date
  creator: string
  token: string
  tokenSymbol: string
  tokenAddress?: string
  action: AlertAction
  confidence: number
  entryPrice: number
  currentPrice: number
  exitPrice?: number
  status: AlertStatus
  pnl: number
  pnlPercent: number
  timeToAth?: number // minutes
  maxDrawdown?: number // percentage
  athPrice?: number
  exitReason?: string
  isReentry?: boolean
  volumeSOL?: number
}

export interface KPIMetrics {
  totalPnl: number
  totalPnlPercent: number
  signalAccuracy: number
  activeAlerts: number
  alphaVsMarket: number
  avgTimeToAth: number
  hitRatio: number
}

export interface PerformanceDataPoint {
  timestamp: Date
  portfolioPnl: number
  marketPnl: number
  alpha: number
  activeSignals: number
}

export interface HistoricalAlert extends Alert {
  closedAt?: Date
  holdDuration?: number // minutes
}
