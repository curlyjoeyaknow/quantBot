import { Suspense } from 'react';
import { getSimulationRuns } from '../lib/services/simulation-service';
import { SimulationRunsTable } from '../components/tables/SimulationRunsTable';

export const dynamic = 'force-dynamic';

export default async function SimulationsPage() {
  const runs = await getSimulationRuns();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Simulation Results</h1>
        <p className="text-muted-foreground mt-2">
          View and analyze simulation runs
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <Suspense fallback={<div>Loading simulations...</div>}>
          <SimulationRunsTable runs={runs} />
        </Suspense>
      </div>
    </div>
  );
}

