import { Suspense } from 'react';
import {
  getSimulationRun,
  getSimulationEvents,
} from '../../lib/services/simulation-service';
import { formatNumber, formatDate } from '../../lib/format';
import { PnLChart } from '../../components/charts/PnLChart';
import { SimulationEventsTable } from '../../components/tables/SimulationEventsTable';
import { StatsCard } from '../../components/dashboard/StatsCard';
import { InfoCard } from '../../components/ui/InfoCard';
import { Badge } from '../../components/ui/Badge';
import { RefreshButton } from '../../components/ui/RefreshButton';
import { ExportButton } from '../../components/ui/ExportButton';
import Link from 'next/link';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { ChartSkeleton } from '../../components/ui/Skeleton';

export const dynamic = 'force-dynamic';

export default async function SimulationRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const [run, events] = await Promise.all([
    getSimulationRun(runId),
    getSimulationEvents(runId),
  ]);

  const exportData = events.map((event) => ({
    Timestamp: event.event_time,
    Type: event.event_type,
    Token: event.token_address || '-',
    Price: event.price || 0,
    Size: event.size || 0,
    'Remaining Position': event.remaining_position || 0,
    'PnL So Far': event.pnl_so_far || 0,
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/simulations"
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to Simulations
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">Simulation Run</h1>
            <Badge variant="info">{run.strategy_name}</Badge>
          </div>
          <p className="text-muted-foreground mt-2">
            Run ID: <span className="font-mono text-xs">{run.run_id}</span>
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {formatDate(run.from_iso)} - {formatDate(run.to_iso)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton data={exportData} filename={`simulation-${runId}`} format="csv" />
          <ExportButton data={exportData} filename={`simulation-${runId}`} format="json" />
          <RefreshButton />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Calls"
          value={run.total_calls?.toLocaleString() ?? '-'}
          tooltip="Total number of calls processed in this simulation"
        />
        <StatsCard
          title="Total Trades"
          value={run.total_trades?.toLocaleString() ?? '-'}
          tooltip="Total number of trades executed"
        />
        <StatsCard
          title="PnL Mean"
          value={formatNumber(run.pnl_mean)}
          tooltip="Average profit/loss across all trades"
          trend={
            run.pnl_mean && run.pnl_mean >= 0
              ? { value: 0, label: '', isPositive: true }
              : { value: 0, label: '', isPositive: false }
          }
        />
        <StatsCard
          title="PnL Median"
          value={formatNumber(run.pnl_median)}
          tooltip="Median profit/loss across all trades"
          trend={
            run.pnl_median && run.pnl_median >= 0
              ? { value: 0, label: '', isPositive: true }
              : { value: 0, label: '', isPositive: false }
          }
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <InfoCard title="Run Statistics">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Caller:</span>
              <span className="font-medium">{run.caller_name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Successful Calls:</span>
              <span className="font-medium">{run.successful_calls?.toLocaleString() ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Failed Calls:</span>
              <span className="font-medium text-red-600 dark:text-red-400">
                {run.failed_calls?.toLocaleString() ?? '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PnL Min:</span>
              <span className="font-medium">{formatNumber(run.pnl_min)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PnL Max:</span>
              <span className="font-medium">{formatNumber(run.pnl_max)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">{formatDate(run.created_at)}</span>
            </div>
          </div>
        </InfoCard>
        <InfoCard title="Performance Summary">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Success Rate:</span>
              <Badge
                variant={
                  run.total_calls && run.successful_calls
                    ? (run.successful_calls / run.total_calls) * 100 >= 50
                      ? 'success'
                      : 'warning'
                    : 'default'
                }
              >
                {run.total_calls && run.successful_calls
                  ? `${((run.successful_calls / run.total_calls) * 100).toFixed(1)}%`
                  : '-'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Overall PnL:</span>
              <Badge
                variant={
                  run.pnl_mean && run.pnl_mean >= 0 ? 'success' : 'error'
                }
              >
                {formatNumber(run.pnl_mean)}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trades per Call:</span>
              <span className="font-medium">
                {run.total_calls && run.total_trades
                  ? (run.total_trades / run.total_calls).toFixed(2)
                  : '-'}
              </span>
            </div>
          </div>
        </InfoCard>
      </div>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">PnL Over Time</h2>
          <Suspense fallback={<ChartSkeleton />}>
            <PnLChart events={events} />
          </Suspense>
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Simulation Events</h2>
            <span className="text-sm text-muted-foreground">
              {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          </div>
          <Suspense fallback={<div className="animate-pulse space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded"></div>
            ))}
          </div>}>
            <SimulationEventsTable events={events} />
          </Suspense>
        </div>
      </ErrorBoundary>
    </div>
  );
}

