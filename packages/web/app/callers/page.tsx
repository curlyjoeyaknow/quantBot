import { Suspense } from 'react';
import { getCallerMetrics } from '../lib/services/analytics-service';
import type { CallerMetrics } from '../lib/types';
import { EnhancedCallersTable } from '../components/tables/EnhancedCallersTable';
import { RefreshButton } from '../components/ui/RefreshButton';
import { ClientDateRangePicker } from '../components/ui/ClientDateRangePicker';
import { TableSkeleton } from '../components/ui/Skeleton';
import { ErrorDisplay } from '../components/dashboard/ErrorDisplay';
import { DataDebugInfo } from '../components/dashboard/DataDebugInfo';

export const dynamic = 'force-dynamic';

async function getCallersData(): Promise<CallerMetrics[]> {
  return await getCallerMetrics();
}

export default async function CallersPage() {
  let callers: CallerMetrics[] = [];
  let error: Error | null = null;
  
  try {
    callers = await getCallersData();
  } catch (err) {
    console.error('Error loading callers:', err);
    error = err instanceof Error ? err : new Error(String(err));
  }

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

      {error && (
        <ErrorDisplay
          title="Error Loading Callers Data"
          error={error}
          onRetry={() => window.location.reload()}
        />
      )}
      
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <ClientDateRangePicker />
        {callers.length === 0 && !error && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No caller data available.</p>
            <p className="text-sm mt-2">
              Make sure you have ingested call data using the CLI.
            </p>
          </div>
        )}
        {callers.length > 0 && (
          <Suspense fallback={<TableSkeleton rows={10} cols={8} />}>
            <EnhancedCallersTable callers={callers} />
          </Suspense>
        )}
        <DataDebugInfo data={callers} label="Callers Data" />
      </div>
    </div>
  );
}

