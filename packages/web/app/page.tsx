import { Suspense } from 'react';
import { getDashboardSummary } from './lib/services/analytics-service';
import type { DashboardSummary } from './lib/types';
import { DashboardMetrics } from './components/dashboard/DashboardMetrics';
import { TopCallersTable } from './components/dashboard/TopCallersTable';
import { AthDistributionChart } from './components/charts/AthDistributionChart';
import { RecentCallsTable } from './components/dashboard/RecentCallsTable';
import { EmptyDashboard } from './components/dashboard/EmptyDashboard';

export const dynamic = 'force-dynamic';

async function getDashboardData(): Promise<DashboardSummary> {
  return await getDashboardSummary();
}

export default async function HomePage() {
  let dashboard: DashboardSummary;
  try {
    dashboard = await getDashboardData();
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Analytics and simulation overview
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4 text-destructive">Error Loading Data</h2>
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : 'Failed to load dashboard data'}
          </p>
        </div>
      </div>
    );
  }

  const hasData = dashboard.system.totalCalls > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Analytics and simulation overview
        </p>
      </div>

      {!hasData && <EmptyDashboard />}

      <Suspense fallback={<div>Loading metrics...</div>}>
        <DashboardMetrics metrics={dashboard.system} />
      </Suspense>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">Top Callers</h2>
          <Suspense fallback={<div>Loading callers...</div>}>
            <TopCallersTable callers={dashboard.topCallers} />
          </Suspense>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">ATH Distribution</h2>
          <Suspense fallback={<div>Loading chart...</div>}>
            <AthDistributionChart distribution={dashboard.athDistribution} />
          </Suspense>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Recent Calls</h2>
        <Suspense fallback={<div>Loading calls...</div>}>
          <RecentCallsTable calls={dashboard.recentCalls} />
        </Suspense>
      </div>
    </div>
  );
}
