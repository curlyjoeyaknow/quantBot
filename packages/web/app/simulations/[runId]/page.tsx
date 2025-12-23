import { Suspense } from 'react';
import {
  getSimulationRun,
  getSimulationEvents,
} from '../../lib/services/simulation-service';
import { formatNumber } from '../../lib/format';
import { PnLChart } from '../../components/charts/PnLChart';
import { SimulationEventsTable } from '../../components/tables/SimulationEventsTable';
import Link from 'next/link';

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

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/simulations"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to Simulations
        </Link>
        <h1 className="text-3xl font-bold">Simulation Run: {run.strategy_name}</h1>
        <p className="text-muted-foreground mt-2">
          Run ID: <span className="font-mono text-xs">{run.run_id}</span>
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total Calls</h3>
          <p className="text-2xl font-bold mt-2">{run.total_calls ?? '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total Trades</h3>
          <p className="text-2xl font-bold mt-2">{run.total_trades ?? '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">PnL Mean</h3>
          <p className="text-2xl font-bold mt-2">{formatNumber(run.pnl_mean)}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">PnL Median</h3>
          <p className="text-2xl font-bold mt-2">{formatNumber(run.pnl_median)}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">PnL Over Time</h2>
        <Suspense fallback={<div>Loading chart...</div>}>
          <PnLChart events={events} />
        </Suspense>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Simulation Events</h2>
        <Suspense fallback={<div>Loading events...</div>}>
          <SimulationEventsTable events={events} />
        </Suspense>
      </div>
    </div>
  );
}

