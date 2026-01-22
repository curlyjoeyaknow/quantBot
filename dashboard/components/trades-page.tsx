"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Trade {
  date: string
  token: string
  buy: number
  sell: number | null
  pnl: number | null
  multiplier: string | null
  status: "open" | "closed"
}

interface TradesPageProps {
  trades: Trade[]
  hideHeader?: boolean
}

export function TradesPage({ trades, hideHeader = false }: TradesPageProps) {
  return (
    <div>
      {!hideHeader && (
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Trade History</h1>
          <p className="text-muted-foreground mt-1">Complete log of all executed trades</p>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Token</TableHead>
                  <TableHead className="font-semibold text-right">Buy Price</TableHead>
                  <TableHead className="font-semibold text-right">Sell Price</TableHead>
                  <TableHead className="font-semibold text-right">PNL</TableHead>
                  <TableHead className="font-semibold text-center">Multiplier</TableHead>
                  <TableHead className="font-semibold text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade, index) => (
                  <TableRow key={index} className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <TableCell className="text-sm">{trade.date}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-medium">
                        {trade.token}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">${trade.buy.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {trade.sell ? `$${trade.sell.toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-medium",
                        trade.pnl === null
                          ? "text-muted-foreground"
                          : trade.pnl >= 0
                            ? "text-emerald-500"
                            : "text-red-500"
                      )}
                    >
                      {trade.pnl === null
                        ? "—"
                        : trade.pnl >= 0
                          ? `+$${trade.pnl.toLocaleString()}`
                          : `-$${Math.abs(trade.pnl).toLocaleString()}`}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-center font-mono text-sm",
                        trade.multiplier === null
                          ? "text-muted-foreground"
                          : parseFloat(trade.multiplier) >= 1
                            ? "text-emerald-500"
                            : "text-red-500"
                      )}
                    >
                      {trade.multiplier || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={trade.status === "open" ? "default" : "secondary"}>
                        {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
