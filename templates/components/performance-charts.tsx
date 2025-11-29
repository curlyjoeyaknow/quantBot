"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import type { PerformanceDataPoint } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

type TimeRange = "24h" | "7d" | "30d"

const timeRangeHours: Record<TimeRange, number> = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
}

function formatTimestamp(date: Date, range: TimeRange): string {
  const d = new Date(date)
  if (range === "24h") {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    value: number
    name: string
    color: string
  }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground font-medium">{entry.name}:</span>
          <span className="text-foreground font-semibold">
            {entry.value >= 0 ? "+" : ""}
            {entry.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export function PerformanceCharts() {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h")

  const { data: performance, error } = useSWR<PerformanceDataPoint[]>(
    `/api/performance?hours=${timeRangeHours[timeRange]}`,
    fetcher,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
    },
  )

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-destructive text-sm">Failed to load performance data. Please try again.</div>
      </Card>
    )
  }

  if (!performance) {
    return <Card className="p-6 h-[400px] animate-pulse bg-muted" />
  }

  const chartData = performance.map((point) => ({
    timestamp: formatTimestamp(point.timestamp, timeRange),
    portfolio: Number(point.portfolioPnl.toFixed(2)),
    market: Number(point.marketPnl.toFixed(2)),
    alpha: Number(point.alpha.toFixed(2)),
    signals: point.activeSignals,
  }))

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Time Range:</span>
        {(["24h", "7d", "30d"] as TimeRange[]).map((range) => (
          <Button
            key={range}
            variant={timeRange === range ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeRange(range)}
          >
            {range}
          </Button>
        ))}
      </div>

      {/* PnL Comparison Chart */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Portfolio vs Market PnL</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="timestamp" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(value) => `${value}%`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "14px" }} />
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="market"
              name="Market"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 5"
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
