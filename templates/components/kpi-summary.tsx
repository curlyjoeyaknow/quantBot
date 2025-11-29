"use client"

import useSWR from "swr"
import { Card } from "@/components/ui/card"
import type { KPIMetrics } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

interface KPICardProps {
  label: string
  value: string
  trend?: "positive" | "negative" | "neutral"
  subtitle?: string
}

function KPICard({ label, value, trend = "neutral", subtitle }: KPICardProps) {
  const trendColor = trend === "positive" ? "text-green-500" : trend === "negative" ? "text-red-500" : "text-foreground"

  return (
    <Card className="p-4 flex flex-col gap-1">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${trendColor}`}>{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
    </Card>
  )
}

export function KPISummary() {
  const { data: metrics, error } = useSWR<KPIMetrics>("/api/metrics", fetcher, {
    refreshInterval: 5000, // Refresh every 5 seconds
  })

  if (error) {
    return <div className="text-destructive text-sm">Failed to load metrics. Please try again.</div>
  }

  if (!metrics) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4 h-24 animate-pulse bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground text-center">
        📊 Backtested Simulation Results (Not Real Trading)
      </div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <KPICard
        label="Total PnL"
        value={formatCurrency(metrics.totalPnl)}
        trend={metrics.totalPnl >= 0 ? "positive" : "negative"}
        subtitle={formatPercent(metrics.totalPnlPercent)}
      />
      <KPICard
        label="Signal Accuracy"
        value={`${metrics.signalAccuracy.toFixed(1)}%`}
        trend={metrics.signalAccuracy >= 70 ? "positive" : "negative"}
      />
      <KPICard label="Active Alerts" value={metrics.activeAlerts.toString()} trend="neutral" />
      <KPICard
        label="Alpha vs Market"
        value={formatPercent(metrics.alphaVsMarket)}
        trend={metrics.alphaVsMarket >= 0 ? "positive" : "negative"}
      />
      <KPICard
        label="Avg Time to ATH"
        value={`${Math.round(metrics.avgTimeToAth)}m`}
        trend="neutral"
        subtitle="minutes"
      />
      <KPICard
        label="Hit Ratio"
        value={`${metrics.hitRatio.toFixed(1)}%`}
        trend={metrics.hitRatio >= 60 ? "positive" : "negative"}
      />
      </div>
    </div>
  )
}
