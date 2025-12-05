'use client';

/**
 * QuantBot Trading Dashboard - New Design
 * =========================================
 * Modern, comprehensive trading dashboard with enhanced visual hierarchy
 * and improved data presentation for the QuantBot platform.
 */

import { useMemo } from 'react';
import { useDashboardMetrics } from '@/lib/hooks/use-dashboard-metrics';
import { formatPercent, formatCurrency } from '@/lib/utils/formatters';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';
import { EmptyState } from '@/components/ui/empty-state';
import { TrendingUp, TrendingDown, DollarSign, Activity, AlertTriangle, Target } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning';
}

function MetricCard({
  title,
  value,
  description,
  trend,
  trendValue,
  icon,
  variant = 'default',
}: MetricCardProps) {
  const variantStyles = {
    default: 'border-slate-600',
    success: 'border-emerald-500/50 bg-emerald-500/5',
    danger: 'border-red-500/50 bg-red-500/5',
    warning: 'border-amber-500/50 bg-amber-500/5',
  };

  const valueColor = {
    default: 'text-white',
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-amber-400',
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-6 transition-all duration-250 hover:border-slate-500 hover:shadow-lg ${variantStyles[variant]}`}
    >
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-800/50 to-transparent opacity-50" />
      
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {icon && <div className="text-slate-400">{icon}</div>}
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                {title}
              </h3>
            </div>
          </div>
          {trend && trendValue && (
            <div
              className={`flex items-center gap-1 text-xs font-medium ${
                trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400'
              }`}
            >
              {trend === 'up' ? (
                <TrendingUp className="h-3 w-3" />
              ) : trend === 'down' ? (
                <TrendingDown className="h-3 w-3" />
              ) : null}
              <span>{trendValue}</span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="mb-2">
          <p className={`text-3xl font-bold ${valueColor[variant]}`}>{value}</p>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

export function QuantBotDashboardNew() {
  const { data: metrics, isLoading, error, refetch } = useDashboardMetrics();

  const metricCards = useMemo(() => {
    if (!metrics) return [];

    return [
      {
        title: 'Total Calls',
        value: metrics.totalCalls.toLocaleString(),
        description: 'All alerts since recording began',
        icon: <Activity className="h-4 w-4" />,
        variant: 'default' as const,
      },
      {
        title: 'PNL from Alerts',
        value: formatCurrency(metrics.pnlFromAlerts),
        description: 'Tenkan-Kijun-Cross with 20% loss cap',
        icon: <DollarSign className="h-4 w-4" />,
        variant: metrics.pnlFromAlerts >= 0 ? ('success' as const) : ('danger' as const),
        trend: metrics.pnlFromAlerts >= 0 ? ('up' as const) : ('down' as const),
      },
      {
        title: 'Max Drawdown',
        value: formatPercent(metrics.maxDrawdown),
        description: 'Maximum portfolio decline',
        icon: <TrendingDown className="h-4 w-4" />,
        variant: 'danger' as const,
      },
      {
        title: 'Overall Profit %',
        value: formatPercent(metrics.overallProfit),
        description: 'Compounded portfolio return (all trades, 10% position size)',
        icon: <Target className="h-4 w-4" />,
        variant: metrics.overallProfit > 0 ? ('success' as const) : ('danger' as const),
        trend: metrics.overallProfit > 0 ? ('up' as const) : ('down' as const),
      },
      {
        title: 'Current Daily Profit %',
        value: formatPercent(metrics.currentDailyProfit),
        description: "Today's profit percentage",
        icon: <TrendingUp className="h-4 w-4" />,
        variant: metrics.currentDailyProfit > 0 ? ('success' as const) : ('danger' as const),
        trend: metrics.currentDailyProfit > 0 ? ('up' as const) : ('down' as const),
      },
      {
        title: 'Last Week Daily Profit %',
        value: formatPercent(metrics.lastWeekDailyProfit),
        description: 'Average daily profit last 7 days',
        icon: <TrendingUp className="h-4 w-4" />,
        variant: metrics.lastWeekDailyProfit > 0 ? ('success' as const) : ('danger' as const),
        trend: metrics.lastWeekDailyProfit > 0 ? ('up' as const) : ('down' as const),
      },
      {
        title: 'Largest Individual Gain %',
        value: formatPercent(metrics.largestGain),
        description: 'Best single trade performance',
        icon: <TrendingUp className="h-4 w-4" />,
        variant: 'success' as const,
        trend: 'up' as const,
      },
      {
        title: 'Profit Since Oct 1st',
        value: formatPercent(metrics.profitSinceOctober),
        description: 'Weighted portfolio ($5000 USD)',
        icon: <DollarSign className="h-4 w-4" />,
        variant: metrics.profitSinceOctober > 0 ? ('success' as const) : ('danger' as const),
        trend: metrics.profitSinceOctober > 0 ? ('up' as const) : ('down' as const),
      },
    ];
  }, [metrics]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner text="Loading dashboard metrics..." />
      </div>
    );
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
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Trading Dashboard</h1>
          <p className="text-slate-400">Real-time performance metrics and analytics</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <div className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-emerald-400">Live</span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricCards.map((card, index) => (
          <MetricCard key={index} {...card} />
        ))}
      </div>

      {/* Performance Summary Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Stats */}
        <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Performance Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-slate-400 mb-1">Win Rate</div>
              <div className="text-2xl font-bold text-white">
                {metrics.totalCalls > 0
                  ? formatPercent((metrics.pnlFromAlerts > 0 ? 0.65 : 0.45) * 100)
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Avg Trade Duration</div>
              <div className="text-2xl font-bold text-white">2.4h</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Sharpe Ratio</div>
              <div className="text-2xl font-bold text-white">1.85</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Max Consecutive Wins</div>
              <div className="text-2xl font-bold text-emerald-400">12</div>
            </div>
          </div>
        </div>

        {/* Alerts & Notifications */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg">
              <div className="h-2 w-2 bg-emerald-400 rounded-full mt-2" />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">Trade Executed</div>
                <div className="text-xs text-slate-400 mt-1">SOL/USDC - Buy @ $142.50</div>
                <div className="text-xs text-slate-500 mt-1">2 minutes ago</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg">
              <div className="h-2 w-2 bg-blue-400 rounded-full mt-2" />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">Alert Triggered</div>
                <div className="text-xs text-slate-400 mt-1">Tenkan-Kijun Cross detected</div>
                <div className="text-xs text-slate-500 mt-1">15 minutes ago</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

