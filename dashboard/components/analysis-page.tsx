"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts"

interface AnalysisMetrics {
  avgWeeklyReturn: number
  bestWeek: { label: string; returnPct: number }
  avgMultiplier: number
  bestTrade: { token: string; multiplier: number; date: string }
}

interface WeeklyReturn {
  week: string
  returnPct: number
}

interface TradeMultiplier {
  id: number
  token: string
  multiplier: number
  date: string
}

interface ExecutionMetrics {
  avgExecutionTime: number
  minExecutionTime: number
  maxExecutionTime: number
  targetThreshold: number
}

interface ThisWeekVsAverage {
  thisWeek: number
  average: number
}

interface AnalysisPageProps {
  metrics: AnalysisMetrics
  weeklyReturns: WeeklyReturn[]
  tradeMultipliers: TradeMultiplier[]
  executionMetrics: ExecutionMetrics
  thisWeekVsAverage: ThisWeekVsAverage
}

function getMultiplierColor(multiplier: number) {
  if (multiplier >= 2.0) return "#22c55e"
  if (multiplier >= 1.0) return "#3b82f6"
  return "#ef4444"
}

function getExecutionColor(time: number) {
  if (time <= 140) return "#22c55e"
  if (time <= 200) return "#3b82f6"
  if (time <= 260) return "#f97316"
  return "#ef4444"
}

function PerformanceGauge({ thisWeek, average }: { thisWeek: number; average: number }) {
  const percentage = Math.min((thisWeek / (average * 2)) * 100, 100)
  const isAboveAverage = thisWeek >= average

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="relative w-48 h-24 overflow-hidden">
        <div className="absolute inset-0 border-[12px] border-muted rounded-t-full" />
        <div
          className="absolute inset-0 border-[12px] rounded-t-full transition-all duration-500"
          style={{
            borderColor: isAboveAverage ? "#22c55e" : "#ef4444",
            clipPath: `polygon(0 100%, 0 0, ${percentage}% 0, ${percentage}% 100%)`,
          }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-foreground rounded-full" />
        <div
          className="absolute bottom-0 left-1/2 origin-bottom w-1 h-20 bg-foreground rounded-full transition-all duration-500"
          style={{
            transform: `translateX(-50%) rotate(${(percentage / 100) * 180 - 90}deg)`,
          }}
        />
      </div>
      <div className="mt-4 text-center">
        <p className={cn("text-3xl font-bold", isAboveAverage ? "text-emerald-500" : "text-red-500")}>
          {thisWeek.toFixed(1)}%
        </p>
        <p className="text-sm text-muted-foreground">vs {average.toFixed(1)}% avg</p>
      </div>
    </div>
  )
}

function ExecutionGauge({ metrics }: { metrics: ExecutionMetrics }) {
  const { avgExecutionTime, minExecutionTime, maxExecutionTime, targetThreshold } = metrics
  const range = maxExecutionTime - minExecutionTime
  const avgPosition = ((avgExecutionTime - minExecutionTime) / range) * 100
  const targetPosition = ((targetThreshold - minExecutionTime) / range) * 100

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-full max-w-xs">
        <div className="relative h-6 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute h-full rounded-full transition-all duration-500"
            style={{
              width: `${avgPosition}%`,
              backgroundColor: getExecutionColor(avgExecutionTime),
            }}
          />
          <div
            className="absolute top-0 bottom-0 w-1 bg-orange-500"
            style={{ left: `${targetPosition}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>{minExecutionTime}ms</span>
          <span>{maxExecutionTime}ms</span>
        </div>
      </div>
      <div className="mt-4 text-center">
        <p
          className="text-3xl font-bold"
          style={{ color: getExecutionColor(avgExecutionTime) }}
        >
          {avgExecutionTime}ms
        </p>
        <p className="text-sm text-muted-foreground">Avg Execution Time</p>
        <p className="text-xs text-orange-500 mt-1">Target: {targetThreshold}ms</p>
      </div>
    </div>
  )
}

export function AnalysisPage({
  metrics,
  weeklyReturns,
  tradeMultipliers,
  executionMetrics,
  thisWeekVsAverage,
}: AnalysisPageProps) {
  const sortedMultipliers = [...tradeMultipliers].sort((a, b) => b.multiplier - a.multiplier).slice(0, 15)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Performance Analysis</h1>
        <p className="text-muted-foreground mt-1">Detailed trading metrics and performance insights</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Avg Weekly Return</p>
            <p className="text-2xl font-bold text-emerald-500">+{metrics.avgWeeklyReturn.toFixed(2)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Best Week</p>
            <p className="text-2xl font-bold text-foreground">{metrics.bestWeek.label}</p>
            <p className="text-sm text-emerald-500">+{metrics.bestWeek.returnPct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Avg Multiplier</p>
            <p className="text-2xl font-bold text-foreground">{metrics.avgMultiplier.toFixed(2)}x</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Best Trade</p>
            <p className="text-2xl font-bold text-foreground">{metrics.bestTrade.multiplier}x</p>
            <p className="text-sm text-muted-foreground">{metrics.bestTrade.token}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly PNL Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Weekly PNL Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyReturns} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    tickFormatter={(value) => `${value}%`}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)}%`, "Return"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="returnPct" radius={[4, 4, 0, 0]}>
                    {weeklyReturns.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.returnPct >= 0 ? "#22c55e" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Performance Gauge */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">This Week vs Average</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <PerformanceGauge thisWeek={thisWeekVsAverage.thisWeek} average={thisWeekVsAverage.average} />
            </div>
          </CardContent>
        </Card>

        {/* Trade Multipliers Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Trade Multipliers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedMultipliers}
                  layout="vertical"
                  margin={{ top: 10, right: 10, left: 40, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    domain={[0, 3]}
                    tickFormatter={(value) => `${value}x`}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    type="category"
                    dataKey="token"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value}x`, "Multiplier"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <ReferenceLine x={1} stroke="#888" strokeDasharray="3 3" />
                  <ReferenceLine x={2} stroke="#22c55e" strokeDasharray="3 3" />
                  <Bar dataKey="multiplier" radius={[0, 4, 4, 0]}>
                    {sortedMultipliers.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getMultiplierColor(entry.multiplier)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-emerald-500" />
                <span className="text-muted-foreground">High Gains (2x+)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-muted-foreground">Profitable (1-2x)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-red-500" />
                <span className="text-muted-foreground">Loss (&lt;1x)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Execution Time Gauge */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Order Execution Speed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ExecutionGauge metrics={executionMetrics} />
            </div>
            <div className="flex items-center justify-center gap-4 mt-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-emerald-500" />
                <span className="text-muted-foreground">Excellent</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-muted-foreground">Good</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-orange-500" />
                <span className="text-muted-foreground">Acceptable</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-red-500" />
                <span className="text-muted-foreground">Slow</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
