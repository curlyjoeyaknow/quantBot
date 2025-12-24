import { Suspense } from 'react';
import { getSimulationRuns } from '../lib/services/simulation-service';
import { EnhancedSimulationRunsTable } from '../components/tables/EnhancedSimulationRunsTable';
import { RefreshButton } from '../components/ui/RefreshButton';
import { TableSkeleton } from '../components/ui/Skeleton';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

export const dynamic = 'force-dynamic';

export default async function SimulationsPage() {
  const runs = await getSimulationRuns();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Simulation Results</h1>
          <p className="text-muted-foreground mt-2">
            View and analyze simulation runs
          </p>
        </div>
        <RefreshButton />
      </div>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <Suspense fallback={<TableSkeleton rows={10} cols={9} />}>
            <EnhancedSimulationRunsTable runs={runs} />
          </Suspense>
        </div>
      </ErrorBoundary>
    </div>
  );
}

