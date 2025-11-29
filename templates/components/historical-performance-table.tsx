"use client"

import type React from "react"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { HistoricalAlert } from "@/lib/types"
import { ArrowUpIcon, ArrowDownIcon, ArrowUpDown } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

type SortField = "timestamp" | "pnl" | "holdDuration" | "timeToAth"
type SortDirection = "asc" | "desc"

function formatPrice(price: number): string {
  if (price < 0.01) return price.toFixed(6)
  return price.toFixed(4)
}

function formatDuration(minutes?: number): string {
  if (!minutes) return "N/A"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function HistoricalPerformanceTable() {
  const [searchToken, setSearchToken] = useState("")
  const [filterCreator, setFilterCreator] = useState<string>("all")
  const [filterAction, setFilterAction] = useState<string>("all")
  const [sortField, setSortField] = useState<SortField>("timestamp")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const { data: alerts, error } = useSWR<HistoricalAlert[]>("/api/historical", fetcher)

  const creators = useMemo(() => {
    if (!alerts) return []
    return Array.from(new Set(alerts.map((a) => a.creator))).sort()
  }, [alerts])

  const filteredAndSortedAlerts = useMemo(() => {
    if (!alerts) return []

    const filtered = alerts.filter((alert) => {
      const matchesToken =
        searchToken === "" ||
        alert.tokenSymbol.toLowerCase().includes(searchToken.toLowerCase()) ||
        alert.token.toLowerCase().includes(searchToken.toLowerCase())
      const matchesCreator = filterCreator === "all" || alert.creator === filterCreator
      const matchesAction = filterAction === "all" || alert.action === filterAction

      return matchesToken && matchesCreator && matchesAction
    })

    filtered.sort((a, b) => {
      let aValue: number
      let bValue: number

      switch (sortField) {
        case "timestamp":
          aValue = new Date(a.timestamp).getTime()
          bValue = new Date(b.timestamp).getTime()
          break
        case "pnl":
          aValue = a.pnl
          bValue = b.pnl
          break
        case "holdDuration":
          aValue = a.holdDuration || 0
          bValue = b.holdDuration || 0
          break
        case "timeToAth":
          aValue = a.timeToAth || 0
          bValue = b.timeToAth || 0
          break
        default:
          return 0
      }

      return sortDirection === "asc" ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [alerts, searchToken, filterCreator, filterAction, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-destructive text-sm">Failed to load historical data. Please try again.</div>
      </Card>
    )
  }

  if (!alerts) {
    return (
      <Card className="p-6">
        <div className="h-[400px] bg-muted animate-pulse rounded" />
      </Card>
    )
  }

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="h-8 px-2 hover:bg-muted" onClick={() => handleSort(field)}>
      {children}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  )

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Historical Performance</h2>
          <div className="text-sm text-muted-foreground">
            Showing {filteredAndSortedAlerts.length} of {alerts.length} alerts
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <Input
            placeholder="Search token..."
            value={searchToken}
            onChange={(e) => setSearchToken(e.target.value)}
            className="max-w-xs"
          />

          <Select value={filterCreator} onValueChange={setFilterCreator}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by creator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              {creators.map((creator) => (
                <SelectItem key={creator} value={creator}>
                  {creator}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="buy">Buy</SelectItem>
              <SelectItem value="sell">Sell</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Action</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">
                  <SortButton field="pnl">PnL</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="holdDuration">Duration</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="timeToAth">Time to ATH</SortButton>
                </TableHead>
                <TableHead className="text-right">Max DD</TableHead>
                <TableHead className="text-right">
                  <SortButton field="timestamp">Date</SortButton>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedAlerts.map((alert) => {
                const pnlColor = alert.pnl >= 0 ? "text-green-500" : "text-red-500"
                const actionColor = alert.action === "buy" ? "text-green-500" : "text-red-500"

                return (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge variant="default" className="gap-1">
                        {alert.action === "buy" || alert.action === "sell" ? alert.action.toUpperCase() : alert.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{alert.tokenSymbol}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{alert.creator}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${formatPrice(alert.entryPrice)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${formatPrice(alert.exitPrice || alert.currentPrice)}
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${pnlColor}`}>
                      {alert.pnl >= 0 ? "+" : ""}
                      {alert.pnl.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatDuration(alert.holdDuration)}</TableCell>
                    <TableCell className="text-right text-sm">{formatDuration(alert.timeToAth)}</TableCell>
                    <TableCell className="text-right text-sm text-red-500">
                      {alert.maxDrawdown ? `-${alert.maxDrawdown.toFixed(1)}%` : "N/A"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {new Date(alert.timestamp).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {filteredAndSortedAlerts.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No alerts match your filters. Try adjusting your search criteria.
          </div>
        )}
      </div>
    </Card>
  )
}
