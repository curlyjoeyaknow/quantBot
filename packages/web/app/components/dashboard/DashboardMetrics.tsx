'use client';

import { formatPercent, formatMultiple } from '../../lib/format';
import type { SystemMetrics } from '../../lib/types';

interface DashboardMetricsProps {
  metrics: SystemMetrics;
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium text-muted-foreground">
          Total Calls
        </h3>
        <p className="text-2xl font-bold mt-2">{metrics.totalCalls.toLocaleString()}</p>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium text-muted-foreground">
          Total Callers
        </h3>
        <p className="text-2xl font-bold mt-2">{metrics.totalCallers}</p>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium text-muted-foreground">
          Total Tokens
        </h3>
        <p className="text-2xl font-bold mt-2">{metrics.totalTokens.toLocaleString()}</p>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium text-muted-foreground">
          Simulations Today
        </h3>
        <p className="text-2xl font-bold mt-2">{metrics.simulationsToday}</p>
      </div>
    </div>
  );
}

