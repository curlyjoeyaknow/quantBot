import { Suspense } from 'react';
import { getCallerMetrics } from '../lib/services/analytics-service';
import type { CallerMetrics } from '../lib/types';
import { CallersTable } from '../components/tables/CallersTable';

export const dynamic = 'force-dynamic';

async function getCallersData(): Promise<CallerMetrics[]> {
  return await getCallerMetrics();
}

export default async function CallersPage() {
  const callers = await getCallersData();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Caller Performance</h1>
        <p className="text-muted-foreground mt-2">
          Performance metrics for all callers
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <Suspense fallback={<div>Loading callers...</div>}>
          <CallersTable callers={callers} />
        </Suspense>
      </div>
    </div>
  );
}

