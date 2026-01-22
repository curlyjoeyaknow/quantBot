"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { OverviewPage } from "@/components/overview-page"
import { AnalysisPage } from "@/components/analysis-page"
import { TradesPage } from "@/components/trades-page"
import { TransactionsPage } from "@/components/transactions-page"
import { ExpensesPage } from "@/components/expenses-page"

// Import data from JSON files - edit these files to update your dashboard data
import equityData from "@/data/equity.json"
import stats from "@/data/stats.json"
import trades from "@/data/trades.json"
import activeTrades from "@/data/active-trades.json"
import transactions from "@/data/transactions.json"
import expenses from "@/data/expenses.json"
import monthlySummary from "@/data/monthly-summary.json"
import weeklySummary from "@/data/weekly-summary.json"
import netEquityData from "@/data/net-equity.json"
import weeklyData from "@/data/weekly-data.json"
import analysisData from "@/data/analysis.json"

export type PageType = "overview" | "analysis" | "trades" | "transactions" | "expenses"

// Type the imported data for proper TypeScript support
const typedTrades = trades as Array<{
  date: string
  token: string
  buy: number
  sell: number | null
  pnl: number | null
  multiplier: string | null
  status: "open" | "closed"
}>

const typedTransactions = transactions as Array<{
  date: string
  type: "Deposit" | "Withdrawal" | "PNL Adjustment"
  amount: number
  notes: string
}>

export function DashboardClient() {
  const [currentPage, setCurrentPage] = useState<PageType>("overview")
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // Check system preference on mount
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    setIsDark(prefersDark)
    if (prefersDark) {
      document.documentElement.classList.add("dark")
    }
  }, [])

  const toggleTheme = () => {
    setIsDark(!isDark)
    document.documentElement.classList.toggle("dark")
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Navbar currentPage={currentPage} onPageChange={setCurrentPage} isDark={isDark} onToggleTheme={toggleTheme} />
      <main className="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {currentPage === "overview" && (
          <OverviewPage
            equityData={equityData}
            stats={stats}
            activeTrades={activeTrades}
            weeklyData={weeklyData}
          />
        )}
        {currentPage === "analysis" && (
          <AnalysisPage
            metrics={analysisData.metrics}
            weeklyReturns={analysisData.weeklyReturns}
            tradeMultipliers={analysisData.tradeMultipliers}
            executionMetrics={analysisData.executionMetrics}
            thisWeekVsAverage={analysisData.thisWeekVsAverage}
          />
        )}
        {currentPage === "trades" && <TradesPage trades={typedTrades} />}
        {currentPage === "transactions" && <TransactionsPage transactions={typedTransactions} />}
        {currentPage === "expenses" && (
          <ExpensesPage
            expenses={expenses}
            monthlySummary={monthlySummary}
            weeklySummary={weeklySummary}
            netEquityData={netEquityData}
          />
        )}
      </main>
    </div>
  )
}
