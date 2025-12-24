import { Suspense } from 'react';
import { getCallerMetrics } from '../lib/services/analytics-service';
import type { CallerMetrics } from '../lib/types';
import { EnhancedCallersTable } from '../components/tables/EnhancedCallersTable';
import { RefreshButton } from '../components/ui/RefreshButton';
import { ClientDateRangePicker } from '../components/ui/ClientDateRangePicker';
import { TableSkeleton } from '../components/ui/Skeleton';

export const dynamic = 'force-dynamic';

async function getCallersData(): Promise<CallerMetrics[]> {
  return await getCallerMetrics();
}

export default async function CallersPage() {
  const callers = await getCallersData();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Caller Performance</h1>
          <p className="text-muted-foreground mt-2">
            Performance metrics for all callers
          </p>
        </div>
        <RefreshButton />
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <ClientDateRangePicker />
        <Suspense fallback={<TableSkeleton rows={10} cols={8} />}>
          <EnhancedCallersTable callers={callers} />
        </Suspense>
      </div>
    </div>
  );
}

