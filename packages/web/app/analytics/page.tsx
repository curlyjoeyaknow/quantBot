import { Suspense } from 'react';
import { getAthDistribution } from '../lib/services/analytics-service';
import type { AthDistribution } from '../lib/types';
import { AthDistributionChart } from '../components/charts/AthDistributionChart';

export const dynamic = 'force-dynamic';

async function getAthDistributionData(): Promise<AthDistribution[]> {
  return await getAthDistribution();
}

export default async function AnalyticsPage() {
  const distribution = await getAthDistributionData();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="text-muted-foreground mt-2">
          Deep dive into analytics and metrics
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">ATH Distribution</h2>
        <Suspense fallback={<div>Loading chart...</div>}>
          <AthDistributionChart distribution={distribution} />
        </Suspense>
      </div>
    </div>
  );
}

