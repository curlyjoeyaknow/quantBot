"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Transaction {
  date: string
  type: "Deposit" | "Withdrawal" | "PNL Adjustment"
  amount: number
  notes: string
}

interface TransactionsPageProps {
  transactions: Transaction[]
}

export function TransactionsPage({ transactions }: TransactionsPageProps) {
  const getTypeBadgeVariant = (type: Transaction["type"]) => {
    switch (type) {
      case "Deposit":
        return "default"
      case "Withdrawal":
        return "destructive"
      case "PNL Adjustment":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Transaction History</h1>
        <p className="text-muted-foreground mt-1">Deposits, withdrawals, and PNL adjustments</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold text-right">Amount</TableHead>
                  <TableHead className="font-semibold">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, index) => (
                  <TableRow key={index} className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <TableCell className="text-sm">{tx.date}</TableCell>
                    <TableCell>
                      <Badge variant={getTypeBadgeVariant(tx.type)}>{tx.type}</Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-medium",
                        tx.amount >= 0 ? "text-emerald-500" : "text-red-500"
                      )}
                    >
                      {tx.amount >= 0 ? `+$${tx.amount.toLocaleString()}` : `-$${Math.abs(tx.amount).toLocaleString()}`}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tx.notes}</TableCell>
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
