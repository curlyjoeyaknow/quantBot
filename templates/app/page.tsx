import { KPISummary } from "@/components/kpi-summary"
import { LiveAlertsMonitor } from "@/components/live-alerts-monitor"
import { PerformanceCharts } from "@/components/performance-charts"
import { HistoricalPerformanceTable } from "@/components/historical-performance-table"

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0f1e] to-[#1a1f35] p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <header className="glass-card rounded-2xl p-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10" />
          <div className="relative z-10 space-y-2">
            <h1 className="text-4xl font-bold text-gradient-purple">Sniper Alerts Dashboard</h1>
            <p className="text-slate-300 text-lg">
              Real-time monitoring of cryptocurrency sniper bot signals and performance metrics
            </p>
          </div>
        </header>

        <KPISummary />

        <LiveAlertsMonitor />

        <PerformanceCharts />

        <HistoricalPerformanceTable />
      </div>
    </main>
  )
}
