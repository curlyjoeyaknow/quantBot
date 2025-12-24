import { Suspense } from 'react';
import { getCallerMetrics } from '../../lib/services/analytics-service';
import { getAthDistribution } from '../../lib/services/analytics-service';
import { formatPercent, formatMultiple, formatDate } from '../../lib/format';
import { StatsCard } from '../../components/dashboard/StatsCard';
import { AthDistributionChart } from '../../components/charts/AthDistributionChart';
import { PerformanceChart } from '../../components/charts/PerformanceChart';
import { RefreshButton } from '../../components/ui/RefreshButton';
import { ClientDateRangePicker } from '../../components/ui/ClientDateRangePicker';
import { InfoCard } from '../../components/ui/InfoCard';
import { Badge } from '../../components/ui/Badge';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { ChartSkeleton } from '../../components/ui/Skeleton';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CallerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ callerName: string }>;
  searchParams: { from?: string; to?: string };
}) {
  const { callerName } = await params;
  const decodedName = decodeURIComponent(callerName);
  
  const from = searchParams.from ? new Date(searchParams.from) : undefined;
  const to = searchParams.to ? new Date(searchParams.to) : undefined;

  const [allCallers, distribution] = await Promise.all([
    getCallerMetrics({ from, to, callerName: decodedName }),
    getAthDistribution({ from, to, callerName: decodedName }),
  ]);

  const caller = allCallers.find((c) => c.callerName === decodedName);

  if (!caller) {
    notFound();
  }

  // Mock time series data - in real implementation, this would come from analytics service
  const timeSeriesData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return {
      date: date.toISOString().split('T')[0],
      winRate: caller.winRate + (Math.random() - 0.5) * 0.1,
      avgMultiple: caller.avgMultiple + (Math.random() - 0.5) * 0.5,
      totalCalls: Math.floor(caller.totalCalls / 30) + Math.floor(Math.random() * 10),
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/callers"
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to Callers
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{decodedName}</h1>
            <Badge
              variant={caller.winRate >= 0.5 ? 'success' : caller.winRate >= 0.3 ? 'warning' : 'error'}
            >
              {formatPercent(caller.winRate)} Win Rate
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2">
            Performance metrics and analytics for this caller
          </p>
        </div>
        <RefreshButton />
      </div>

      <div className="flex items-center gap-4">
        <ClientDateRangePicker />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Calls"
          value={caller.totalCalls.toLocaleString()}
          tooltip="Total number of calls made by this caller"
        />
        <StatsCard
          title="Win Rate"
          value={formatPercent(caller.winRate)}
          tooltip="Percentage of profitable calls"
          trend={{
            value: 0,
            label: '',
            isPositive: caller.winRate >= 0.5,
          }}
        />
        <StatsCard
          title="Avg Multiple"
          value={formatMultiple(caller.avgMultiple)}
          tooltip="Average return multiple across all calls"
        />
        <StatsCard
          title="Best Multiple"
          value={formatMultiple(caller.bestMultiple)}
          tooltip="Highest return multiple achieved"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <InfoCard title="Performance Metrics">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Worst Multiple:</span>
              <span className="font-medium text-red-600 dark:text-red-400">
                {formatMultiple(caller.worstMultiple)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">First Call:</span>
              <span className="font-medium">{formatDate(caller.firstCall)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Call:</span>
              <span className="font-medium">{formatDate(caller.lastCall)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Call Frequency:</span>
              <span className="font-medium">
                {caller.totalCalls > 0 && caller.firstCall && caller.lastCall
                  ? `${Math.round(
                      (new Date(caller.lastCall).getTime() -
                        new Date(caller.firstCall).getTime()) /
                        (1000 * 60 * 60 * 24) /
                        caller.totalCalls
                    )} days/call`
                  : '-'}
              </span>
            </div>
          </div>
        </InfoCard>
        <InfoCard title="Performance Summary">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Overall Performance:</span>
              <Badge
                variant={
                  caller.avgMultiple >= 2
                    ? 'success'
                    : caller.avgMultiple >= 1
                      ? 'info'
                      : 'error'
                }
              >
                {caller.avgMultiple >= 2
                  ? 'Excellent'
                  : caller.avgMultiple >= 1
                    ? 'Good'
                    : 'Poor'}
              </Badge>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(caller.winRate * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Win rate visualization
            </p>
          </div>
        </InfoCard>
      </div>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">Performance Over Time</h2>
          <Suspense fallback={<ChartSkeleton />}>
            <PerformanceChart data={timeSeriesData} />
          </Suspense>
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">ATH Distribution</h2>
          <Suspense fallback={<ChartSkeleton />}>
            <AthDistributionChart distribution={distribution} />
          </Suspense>
        </div>
      </ErrorBoundary>
    </div>
  );
}

