"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EquityChart } from "@/components/equity-chart"
import { ActiveTrades } from "@/components/active-trades"
import { TradesPage } from "@/components/trades-page"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface Stats {
  totalPNL: number
  equity: number
  activeTrades: number
  winRate: number
  weeklyPNL: number
}

interface EquityDataPoint {
  date: string
  equity: number
}

interface ActiveTrade {
  date: string
  token: string
  buy: number
  currentPrice: number
  unrealizedPnl: number
  change: number
}

interface Trade {
  date: string
  token: string
  buy: number
  sell: number | null
  pnl: number | null
  multiplier: string | null
  status: "open" | "closed"
}

interface WeekData {
  id: string
  label: string
  dateRange: string
  stats: Stats
  trades: Trade[]
  activeTrades: ActiveTrade[]
  returnPct: number
}

interface OverviewPageProps {
  equityData: EquityDataPoint[]
  stats: Stats
  activeTrades: ActiveTrade[]
  weeklyData: { weeks: WeekData[] }
}

function formatCurrency(value: number) {
  const formatted = Math.abs(value).toLocaleString()
  return value >= 0 ? `+$${formatted}` : `-$${formatted}`
}

export function OverviewPage({ equityData, stats, activeTrades, weeklyData }: OverviewPageProps) {
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0)
  const weeks = weeklyData.weeks

  const currentWeek = weeks[selectedWeekIndex]
  const displayStats = selectedWeekIndex === 0 ? stats : currentWeek.stats
  const displayActiveTrades = selectedWeekIndex === 0 ? activeTrades : currentWeek.activeTrades
  const displayTrades = currentWeek.trades

  const canGoPrev = selectedWeekIndex < weeks.length - 1
  const canGoNext = selectedWeekIndex > 0

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Performance Overview</h1>
          <p className="text-muted-foreground mt-1">Track your automated trading bot performance</p>
        </div>

        {/* Week Toggle */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedWeekIndex((prev) => prev + 1)}
            disabled={!canGoPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center min-w-[140px]">
            <p className="font-semibold text-foreground">{currentWeek.label}</p>
            <p className="text-xs text-muted-foreground">{currentWeek.dateRange}</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedWeekIndex((prev) => prev - 1)}
            disabled={!canGoNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total PNL</p>
            <p className={cn("text-2xl font-bold", displayStats.totalPNL >= 0 ? "text-emerald-500" : "text-red-500")}>
              {formatCurrency(displayStats.totalPNL)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total Equity</p>
            <p className="text-2xl font-bold text-foreground">${displayStats.equity.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Active Trades</p>
            <p className="text-2xl font-bold text-foreground">{displayStats.activeTrades}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-foreground">{displayStats.winRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">{"Week's PNL"}</p>
            <p className={cn("text-2xl font-bold", displayStats.weeklyPNL >= 0 ? "text-emerald-500" : "text-red-500")}>
              {formatCurrency(displayStats.weeklyPNL)}
            </p>
          </CardContent>
        </Card>
      </div>

      <EquityChart data={equityData} />

      {displayActiveTrades.length > 0 && <ActiveTrades trades={displayActiveTrades} />}

      {/* Week's Trades Table */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">{currentWeek.label} Trades</h2>
        <TradesPage trades={displayTrades} hideHeader />
      </div>
    </div>
  )
}
