import { Suspense } from 'react';
import { getSimulationRuns } from '../../lib/services/simulation-service';
import { ComparisonView } from '../../components/ui/ComparisonView';
import { RefreshButton } from '../../components/ui/RefreshButton';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SimulationComparePage({
  searchParams,
}: {
  searchParams: { runIds?: string };
}) {
  const runs = await getSimulationRuns({ limit: 100 });
  
  const selectedRunIds = searchParams.runIds
    ? searchParams.runIds.split(',').filter(Boolean)
    : [];

  const comparisonItems = runs
    .filter((run) => selectedRunIds.length === 0 || selectedRunIds.includes(run.run_id))
    .slice(0, 5)
    .map((run) => ({
      id: run.run_id,
      name: run.strategy_name,
      metrics: {
        totalCalls: run.total_calls ?? 0,
        winRate: run.successful_calls && run.total_calls
          ? run.successful_calls / run.total_calls
          : 0,
        avgMultiple: run.pnl_mean ?? 0,
        bestMultiple: run.pnl_max ?? 0,
        worstMultiple: run.pnl_min ?? 0,
      },
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
          <h1 className="text-3xl font-bold">Compare Simulations</h1>
          <p className="text-muted-foreground mt-2">
            Compare performance metrics across multiple simulation runs
          </p>
        </div>
        <RefreshButton />
      </div>

      <ErrorBoundary>
        <ComparisonView
          items={comparisonItems}
          title="Simulation Comparison"
        />
      </ErrorBoundary>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Available Runs</h2>
        <div className="space-y-2">
          {runs.slice(0, 10).map((run) => (
            <div
              key={run.run_id}
              className="flex items-center justify-between p-3 rounded border hover:bg-muted/50 transition-colors"
            >
              <div>
                <p className="font-medium">{run.strategy_name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {run.run_id.substring(0, 16)}...
                </p>
              </div>
              <Link
                href={`/simulations/${run.run_id}`}
                className="text-sm text-primary hover:underline"
              >
                View Details →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

