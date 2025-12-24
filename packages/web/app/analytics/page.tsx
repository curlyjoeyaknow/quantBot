import { Suspense } from 'react';
import { getAthDistribution } from '../lib/services/analytics-service';
import { AthDistributionChart } from '../components/charts/AthDistributionChart';
import { RefreshButton } from '../components/ui/RefreshButton';
import { ClientDateRangePicker } from '../components/ui/ClientDateRangePicker';
import { ChartSkeleton } from '../components/ui/Skeleton';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const distribution = await getAthDistribution();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-2">
            Advanced analytics and insights
          </p>
        </div>
        <RefreshButton />
      </div>

      <ErrorBoundary>
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <ClientDateRangePicker />
          <div>
            <h2 className="text-xl font-semibold mb-4">ATH Distribution</h2>
            <Suspense fallback={<ChartSkeleton />}>
              <AthDistributionChart distribution={distribution} />
            </Suspense>
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
