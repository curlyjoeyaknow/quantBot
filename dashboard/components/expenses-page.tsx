"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Download, Eye, X } from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"

interface Expense {
  id: string
  date: string
  category: string
  description: string
  amount: number
  invoiceUrl: string
}

interface MonthlySummary {
  month: string
  totalExpenses: number
  totalPnl: number
  netEquity: number
}

interface WeeklySummary {
  week: string
  startDate: string
  endDate: string
  totalExpenses: number
  totalPnl: number
  netEquity: number
}

interface NetEquityDataPoint {
  date: string
  grossEquity: number
  expenses: number
  netEquity: number
}

interface ExpensesPageProps {
  expenses: Expense[]
  monthlySummary: MonthlySummary[]
  weeklySummary: WeeklySummary[]
  netEquityData: NetEquityDataPoint[]
}

export function ExpensesPage({ expenses, monthlySummary, weeklySummary, netEquityData }: ExpensesPageProps) {
  const [selectedInvoice, setSelectedInvoice] = useState<Expense | null>(null)
  const [chartPeriod, setChartPeriod] = useState<"daily" | "weekly">("daily")

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
  const totalPnl = monthlySummary.reduce((sum, m) => sum + m.totalPnl, 0)
  const currentNetEquity = netEquityData[netEquityData.length - 1]?.netEquity || 0

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const chartData = chartPeriod === "daily" 
    ? netEquityData 
    : weeklySummary.map(w => ({
        date: w.week,
        netEquity: w.netEquity,
        grossEquity: w.netEquity + w.totalExpenses,
        expenses: w.totalExpenses,
      }))

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Expenses</div>
            <div className="text-2xl font-bold text-destructive">
              -{formatCurrency(totalExpenses)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total PNL (Gross)</div>
            <div className="text-2xl font-bold text-emerald-500">
              +{formatCurrency(totalPnl)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Net Equity</div>
            <div className="text-2xl font-bold text-foreground">
              {formatCurrency(currentNetEquity)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Net Equity Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Net Equity (After Expenses)</CardTitle>
          <div className="flex gap-2">
            <Button
              variant={chartPeriod === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setChartPeriod("daily")}
            >
              Daily
            </Button>
            <Button
              variant={chartPeriod === "weekly" ? "default" : "outline"}
              size="sm"
              onClick={() => setChartPeriod("weekly")}
            >
              Weekly
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netEquityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    if (chartPeriod === "weekly") return value
                    const date = new Date(value)
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [formatCurrency(value), "Net Equity"]}
                  labelFormatter={(label) => {
                    if (chartPeriod === "weekly") return label
                    return new Date(label).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="netEquity"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#netEquityGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Gross PNL</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Net Equity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlySummary.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-medium">{row.month}</TableCell>
                  <TableCell className="text-right text-emerald-500">
                    +{formatCurrency(row.totalPnl)}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    -{formatCurrency(row.totalExpenses)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(row.netEquity)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Weekly Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Gross PNL</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Net Equity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklySummary.map((row) => (
                <TableRow key={row.week}>
                  <TableCell className="font-medium">{row.week}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.startDate} - {row.endDate}
                  </TableCell>
                  <TableCell className="text-right text-emerald-500">
                    +{formatCurrency(row.totalPnl)}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    -{formatCurrency(row.totalExpenses)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(row.netEquity)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Expenses List */}
      <Card>
        <CardHeader>
          <CardTitle>Expense Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>{expense.date}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{expense.category}</Badge>
                  </TableCell>
                  <TableCell>{expense.description}</TableCell>
                  <TableCell className="text-right text-destructive font-medium">
                    -{formatCurrency(expense.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedInvoice(expense)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={expense.invoiceUrl} download>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* PDF Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold">Invoice - {selectedInvoice.description}</h3>
                <p className="text-sm text-muted-foreground">{selectedInvoice.date}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={selectedInvoice.invoiceUrl} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedInvoice(null)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              <div className="bg-muted rounded-lg h-[600px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg font-medium mb-2">Invoice Preview</p>
                  <p className="text-sm">PDF viewer placeholder</p>
                  <p className="text-sm mt-4">
                    Invoice for: <span className="font-medium">{selectedInvoice.description}</span>
                  </p>
                  <p className="text-sm">
                    Amount: <span className="font-medium text-destructive">-{formatCurrency(selectedInvoice.amount)}</span>
                  </p>
                  <p className="text-xs mt-4 text-muted-foreground/60">
                    Connect to your invoice storage to display actual PDFs
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
