import type { Alert, AlertStatus, AlertAction, KPIMetrics, PerformanceDataPoint, HistoricalAlert } from "./types"

const TOKENS = [
  { symbol: "PEPE", name: "Pepe", basePrice: 0.000012 },
  { symbol: "WIF", name: "dogwifhat", basePrice: 2.45 },
  { symbol: "BONK", name: "Bonk", basePrice: 0.000025 },
  { symbol: "POPCAT", name: "Popcat", basePrice: 0.85 },
  { symbol: "MEW", name: "Cat in a Dogs World", basePrice: 0.0065 },
  { symbol: "BRETT", name: "Brett", basePrice: 0.15 },
  { symbol: "MOODENG", name: "Moo Deng", basePrice: 0.32 },
  { symbol: "GOAT", name: "Goatseus Maximus", basePrice: 0.55 },
]

const CREATORS = ["SniperBot_Alpha", "CryptoWhale_X", "MemeHunter_Pro", "DeFi_Sniper", "TokenScout_AI"]

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomInRange(min, max))
}

function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

export function generateMockAlert(overrides?: Partial<Alert>): Alert {
  const token = randomElement(TOKENS)
  const action: AlertAction = Math.random() > 0.5 ? "buy" : "sell"
  const confidence = randomInRange(0.6, 0.95)
  const entryPrice = token.basePrice * randomInRange(0.8, 1.2)

  // Generate realistic price movement
  const priceChange = randomInRange(-0.3, 0.8) // -30% to +80%
  const currentPrice = entryPrice * (1 + priceChange)

  const pnl = action === "buy" ? (currentPrice - entryPrice) / entryPrice : (entryPrice - currentPrice) / entryPrice

  const status: AlertStatus = Math.random() > 0.7 ? "active" : Math.random() > 0.5 ? "closed" : "stopped"

  const athMultiplier = Math.max(1, 1 + Math.abs(pnl) * randomInRange(1, 2))
  const athPrice = action === "buy" ? entryPrice * athMultiplier : entryPrice / athMultiplier

  return {
    id: `alert-${Date.now()}-${randomInt(1000, 9999)}`,
    timestamp: new Date(Date.now() - randomInt(0, 3600000)), // Last hour
    creator: randomElement(CREATORS),
    token: token.name,
    tokenSymbol: token.symbol,
    action,
    confidence,
    entryPrice,
    currentPrice,
    status,
    pnl: pnl * 100, // Convert to percentage
    pnlPercent: pnl * 100,
    timeToAth: status !== "active" ? randomInt(5, 180) : undefined,
    maxDrawdown: randomInRange(5, 35),
    athPrice,
    ...overrides,
  }
}

export function generateMockAlerts(count: number): Alert[] {
  return Array.from({ length: count }, () => generateMockAlert())
}

export function generateKPIMetrics(): KPIMetrics {
  return {
    totalPnl: randomInRange(-5000, 25000),
    totalPnlPercent: randomInRange(-15, 85),
    signalAccuracy: randomInRange(0.65, 0.88),
    activeAlerts: randomInt(8, 25),
    alphaVsMarket: randomInRange(-5, 35),
    avgTimeToAth: randomInRange(15, 90),
    hitRatio: randomInRange(0.6, 0.85),
  }
}

export function generatePerformanceHistory(hours = 24): PerformanceDataPoint[] {
  const points: PerformanceDataPoint[] = []
  const now = Date.now()
  const interval = (hours * 60 * 60 * 1000) / 100 // 100 data points

  let portfolioPnl = 0
  let marketPnl = 0

  for (let i = 0; i < 100; i++) {
    portfolioPnl += randomInRange(-2, 5)
    marketPnl += randomInRange(-1, 2)

    points.push({
      timestamp: new Date(now - (100 - i) * interval),
      portfolioPnl,
      marketPnl,
      alpha: portfolioPnl - marketPnl,
      activeSignals: randomInt(5, 20),
    })
  }

  return points
}

export function generateHistoricalAlerts(count = 50): HistoricalAlert[] {
  return Array.from({ length: count }, () => {
    const alert = generateMockAlert({ status: "closed" })
    const holdDuration = randomInt(10, 300)

    return {
      ...alert,
      closedAt: new Date(alert.timestamp.getTime() + holdDuration * 60000),
      exitPrice: alert.currentPrice,
      holdDuration,
    }
  })
}
