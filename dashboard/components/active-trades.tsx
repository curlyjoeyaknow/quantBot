"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ActiveTrade {
  date: string
  token: string
  buy: number
  currentPrice: number
  unrealizedPnl: number
  change: number
}

interface ActiveTradesProps {
  trades: ActiveTrade[]
}

export function ActiveTrades({ trades }: ActiveTradesProps) {
  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold">Active Trades</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Entry Date</TableHead>
                <TableHead className="font-semibold">Token</TableHead>
                <TableHead className="font-semibold text-right">Entry Price</TableHead>
                <TableHead className="font-semibold text-right">Current Price</TableHead>
                <TableHead className="font-semibold text-right">Unrealized PNL</TableHead>
                <TableHead className="font-semibold text-right">Change</TableHead>
                <TableHead className="font-semibold text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No active trades
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade, index) => (
                  <TableRow key={index} className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <TableCell className="text-sm">{trade.date}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-medium">
                        {trade.token}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${trade.buy.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${trade.currentPrice.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-medium",
                        trade.unrealizedPnl >= 0 ? "text-emerald-500" : "text-red-500"
                      )}
                    >
                      {trade.unrealizedPnl >= 0
                        ? `+$${trade.unrealizedPnl.toLocaleString()}`
                        : `-$${Math.abs(trade.unrealizedPnl).toLocaleString()}`}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-medium",
                        trade.change >= 0 ? "text-emerald-500" : "text-red-500"
                      )}
                    >
                      {trade.change >= 0 ? `+${trade.change.toFixed(2)}%` : `${trade.change.toFixed(2)}%`}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-amber-500/20 text-amber-600 hover:bg-amber-500/30">
                        Open
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
