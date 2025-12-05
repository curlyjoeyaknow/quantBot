'use client';

import { useMemo, memo } from 'react';
import { useDashboardMetrics } from '@/lib/hooks/use-dashboard-metrics';
import { formatPercent, formatCurrency } from '@/lib/utils/formatters';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';
import { EmptyState } from '@/components/ui/empty-state';

export function Dashboard() {
  const { data: metrics, isLoading, error, refetch } = useDashboardMetrics();

  if (isLoading) {
    return <LoadingSpinner text="Loading dashboard metrics..." className="p-8" />;
  }

  if (error) {
    return (
      <ErrorDisplay
        message={error instanceof Error ? error.message : 'Failed to load dashboard metrics'}
        onRetry={() => refetch()}
      />
    );
  }

  if (!metrics) {
    return (
      <EmptyState
        title="No dashboard data available"
        description="There is no data to display at this time."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Calls"
          value={metrics.totalCalls.toLocaleString()}
          description="All alerts since recording began"
        />
        <MetricCard
          title="PNL from Alerts"
          value={formatCurrency(metrics.pnlFromAlerts)}
          description="Tenkan-Kijun-Cross with 20% loss cap"
        />
        <MetricCard
          title="Max Drawdown"
          value={formatPercent(metrics.maxDrawdown)}
          description="Maximum portfolio decline"
          isNegative={true}
        />
        <MetricCard
          title="Overall Profit %"
          value={formatPercent(metrics.overallProfit)}
          description="Compounded portfolio return (all trades, 10% position size)"
          isPositive={metrics.overallProfit > 0}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Current Daily Profit %"
          value={formatPercent(metrics.currentDailyProfit)}
          description="Today's profit percentage"
          isPositive={metrics.currentDailyProfit > 0}
        />
        <MetricCard
          title="Last Week Daily Profit %"
          value={formatPercent(metrics.lastWeekDailyProfit)}
          description="Average daily profit last 7 days"
          isPositive={metrics.lastWeekDailyProfit > 0}
        />
        <MetricCard
          title="Largest Individual Gain %"
          value={formatPercent(metrics.largestGain)}
          description="Best single trade performance"
          isPositive={true}
        />
        <MetricCard
          title="Profit Since Oct 1st"
          value={formatPercent(metrics.profitSinceOctober)}
          description="Weighted portfolio ($5000 USD)"
          isPositive={metrics.profitSinceOctober > 0}
        />
      </div>
    </div>
  );
}

/**
 * MetricCard component for displaying a single metric with title, value, and description
 * 
 * @param title - The title of the metric
 * @param value - The formatted value to display
 * @param description - Additional description text
 * @param isPositive - Whether the value represents a positive outcome (green color)
 * @param isNegative - Whether the value represents a negative outcome (red color)
 */
const MetricCard = memo(function MetricCard({
  title,
  value,
  description,
  isPositive,
  isNegative,
}: {
  title: string;
  value: string;
  description: string;
  isPositive?: boolean;
  isNegative?: boolean;
}) {
  const colorClass = useMemo(() => {
    return isPositive
      ? 'text-green-400'
      : isNegative
      ? 'text-red-400'
      : 'text-white';
  }, [isPositive, isNegative]);

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h3 className="text-sm font-medium text-slate-400 mb-1">{title}</h3>
      <p className={`text-3xl font-bold ${colorClass} mb-2`}>{value}</p>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  );
});

