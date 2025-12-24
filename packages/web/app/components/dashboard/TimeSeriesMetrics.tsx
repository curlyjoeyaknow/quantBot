'use client';

import { PerformanceChart } from '../charts/PerformanceChart';

interface TimeSeriesMetricsProps {
  data: Array<{
    date: string;
    winRate: number;
    avgMultiple: number;
    totalCalls: number;
  }>;
}

export function TimeSeriesMetrics({ data }: TimeSeriesMetricsProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-xl font-semibold mb-4">Performance Over Time</h2>
      <PerformanceChart data={data} />
    </div>
  );
}

