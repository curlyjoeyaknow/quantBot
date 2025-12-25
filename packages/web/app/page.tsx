import { Suspense } from 'react';
import { getDashboardSummary } from './lib/services/analytics-service';
import { getCallsOverTime } from './lib/services/dashboard-service';
import type { DashboardSummary } from './lib/types';
import { DashboardMetrics } from './components/dashboard/DashboardMetrics';
import { TopCallersTable } from './components/dashboard/TopCallersTable';
import { AthDistributionChart } from './components/charts/AthDistributionChart';
import { RecentCallsTable } from './components/dashboard/RecentCallsTable';
import { CallsOverTimeChart } from './components/dashboard/CallsOverTimeChart';
import { EmptyDashboard } from './components/dashboard/EmptyDashboard';
import { RefreshButton } from './components/ui/RefreshButton';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ErrorDisplay } from './components/dashboard/ErrorDisplay';

export const dynamic = 'force-dynamic';

async function getDashboardData(): Promise<DashboardSummary> {
  return await getDashboardSummary();
}

export default async function HomePage() {
  let dashboard: DashboardSummary;
  let callsOverTime: Array<{ date: string; calls: number; callers: number }> = [];
  let error: Error | null = null;
  try {
      dashboard = await getDashboardData();
      // Get calls over time data (last 90 days for better visualization)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      try {
        callsOverTime = await getCallsOverTime({
          from: ninetyDaysAgo,
          to: new Date(),
          groupBy: 'day',
        });
      } catch (error) {
        console.error('Error loading calls over time:', error);
        callsOverTime = [];
      }
  } catch (err) {
    console.error('Error loading dashboard data:', err);
    error = err instanceof Error ? err : new Error(String(err));
    // Create a minimal dashboard for error state
    dashboard = {
      system: {
        totalCalls: 0,
        totalCallers: 0,
        totalTokens: 0,
        dataRange: {
          start: new Date(),
          end: new Date(),
        },
        simulationsTotal: 0,
        simulationsToday: 0,
      },
      topCallers: [],
      athDistribution: [],
      recentCalls: [],
      generatedAt: new Date(),
    };
  }

  const hasData = dashboard.system.totalCalls > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Analytics and simulation overview
          </p>
        </div>
        <RefreshButton />
      </div>

      {error && (
        <ErrorDisplay
          title="Error Loading Dashboard Data"
          error={error}
          onRetry={() => window.location.reload()}
        />
      )}
      {!hasData && !error && <EmptyDashboard />}

      <ErrorBoundary>
        <Suspense fallback={<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-24 mb-2"></div>
              <div className="h-8 bg-muted rounded w-16"></div>
            </div>
          ))}
        </div>}>
          <DashboardMetrics metrics={dashboard.system} />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">Calls Over Time</h2>
          {callsOverTime.length === 0 ? (
            <p className="text-muted-foreground">No time-series data available</p>
          ) : (
            <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded"></div>}>
              <CallsOverTimeChart data={callsOverTime} />
            </Suspense>
          )}
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold mb-4">Top Callers</h2>
            {dashboard.topCallers.length === 0 ? (
              <p className="text-muted-foreground">No caller data available</p>
            ) : (
              <Suspense fallback={<div className="animate-pulse space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted rounded"></div>
                ))}
              </div>}>
                <TopCallersTable callers={dashboard.topCallers} />
              </Suspense>
            )}
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold mb-4">ATH Distribution</h2>
            {dashboard.athDistribution.length === 0 ? (
              <p className="text-muted-foreground">No ATH distribution data available</p>
            ) : (
              <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded"></div>}>
                <AthDistributionChart distribution={dashboard.athDistribution} />
              </Suspense>
            )}
          </div>
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">Recent Calls</h2>
          {dashboard.recentCalls.length === 0 ? (
            <p className="text-muted-foreground">No recent calls available</p>
          ) : (
            <Suspense fallback={<div className="animate-pulse space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded"></div>
              ))}
            </div>}>
              <RecentCallsTable calls={dashboard.recentCalls} />
            </Suspense>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}
