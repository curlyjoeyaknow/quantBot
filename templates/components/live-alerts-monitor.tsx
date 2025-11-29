"use client"

import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Alert } from "@/lib/types"
import { ArrowUpIcon, ArrowDownIcon } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

function formatPrice(price: number): string {
  if (price < 0.01) {
    return price.toFixed(6)
  }
  return price.toFixed(4)
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const percentage = confidence * 100
  const color = confidence >= 0.8 ? "bg-green-500" : confidence >= 0.6 ? "bg-yellow-500" : "bg-red-500"

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{percentage.toFixed(0)}%</span>
    </div>
  )
}

export function LiveAlertsMonitor() {
  const { data: alerts, error } = useSWR<Alert[]>("/api/alerts", fetcher, {
    refreshInterval: 3000,
  })

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-destructive text-sm">Failed to load alerts. Please try again.</div>
      </Card>
    )
  }

  if (!alerts) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </Card>
    )
  }

  const sortedAlerts = [...alerts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Live Alerts Monitor</h2>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm text-muted-foreground">Live</span>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Action</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead className="text-right">Entry Price</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAlerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No active alerts at the moment
                </TableCell>
              </TableRow>
            ) : (
              sortedAlerts.map((alert) => {
                const pnlColor = alert.pnl >= 0 ? "text-green-500" : "text-red-500"
                const actionColor = alert.action === "buy" ? "text-green-500" : "text-red-500"

                return (
                  <TableRow key={alert.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium uppercase bg-muted px-2 py-1 rounded">
                          {alert.action === "buy" || alert.action === "sell" ? alert.action.toUpperCase() : alert.action}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold">{alert.tokenSymbol}</div>
                      <div className="text-xs text-muted-foreground">{alert.token}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{alert.creator}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${formatPrice(alert.entryPrice)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {alert.status === "active" ? (
                        <span>${formatPrice(alert.currentPrice)}</span>
                      ) : (
                        <span>${formatPrice(alert.exitPrice || alert.currentPrice)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-semibold ${pnlColor}`}>
                        {alert.pnl >= 0 ? "+" : ""}
                        {alert.pnl.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <ConfidenceBar confidence={alert.confidence} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          alert.status === "active"
                            ? "default"
                            : alert.status === "closed"
                              ? "secondary"
                              : "destructive"
                        }
                        className="text-xs"
                      >
                        {alert.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatTimeAgo(alert.timestamp)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
