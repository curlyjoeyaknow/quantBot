"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"

interface EquityDataPoint {
  date: string
  equity: number
}

interface EquityChartProps {
  data: EquityDataPoint[]
}

export function EquityChart({ data }: EquityChartProps) {
  const [timeframe, setTimeframe] = useState<"daily" | "weekly">("daily")

  const chartData = useMemo(() => {
    if (timeframe === "weekly") {
      const weeklyMap = new Map<string, number>()
      data.forEach((item) => {
        const date = new Date(item.date)
        const weekStart = new Date(date)
        weekStart.setDate(date.getDate() - date.getDay())
        const weekKey = weekStart.toISOString().split("T")[0]
        weeklyMap.set(weekKey, item.equity)
      })
      return Array.from(weeklyMap.entries()).map(([date, equity]) => ({ date, equity }))
    }
    return data
  }, [data, timeframe])

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg font-semibold">Equity Curve</CardTitle>
        <div className="flex gap-2">
          <Button
            variant={timeframe === "daily" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTimeframe("daily")}
          >
            Daily
          </Button>
          <Button
            variant={timeframe === "weekly" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTimeframe("weekly")}
          >
            Weekly
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return `${date.getMonth() + 1}/${date.getDate()}`
                }}
                className="text-xs fill-muted-foreground"
              />
              <YAxis
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                className="text-xs fill-muted-foreground"
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                        <p className="text-sm text-muted-foreground">{data.date}</p>
                        <p className="text-lg font-semibold text-foreground">${data.equity.toLocaleString()}</p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#equityGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
