'use client';

import { formatDate, formatNumber } from '../../lib/format';
import Link from 'next/link';

interface SimulationRun {
  run_id: string;
  strategy_name: string;
  caller_name: string | null;
  from_iso: string;
  to_iso: string;
  total_calls: number | null;
  successful_calls: number | null;
  failed_calls: number | null;
  total_trades: number | null;
  pnl_min: number | null;
  pnl_max: number | null;
  pnl_mean: number | null;
  pnl_median: number | null;
  created_at: string;
}

interface SimulationRunsTableProps {
  runs: SimulationRun[];
}

export function SimulationRunsTable({ runs }: SimulationRunsTableProps) {
  if (runs.length === 0) {
    return <p className="text-muted-foreground">No simulation runs available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left p-2">Run ID</th>
            <th className="text-left p-2">Strategy</th>
            <th className="text-left p-2">Caller</th>
            <th className="text-left p-2">Date Range</th>
            <th className="text-right p-2">Total Calls</th>
            <th className="text-right p-2">Total Trades</th>
            <th className="text-right p-2">PnL Mean</th>
            <th className="text-right p-2">PnL Median</th>
            <th className="text-left p-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_id} className="border-b hover:bg-muted/50">
              <td className="p-2">
                <Link
                  href={`/simulations/${run.run_id}`}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {run.run_id.substring(0, 8)}...
                </Link>
              </td>
              <td className="p-2">{run.strategy_name}</td>
              <td className="p-2">{run.caller_name || '-'}</td>
              <td className="p-2 text-xs">
                {formatDate(run.from_iso)} - {formatDate(run.to_iso)}
              </td>
              <td className="text-right p-2">{run.total_calls ?? '-'}</td>
              <td className="text-right p-2">{run.total_trades ?? '-'}</td>
              <td className="text-right p-2">{formatNumber(run.pnl_mean)}</td>
              <td className="text-right p-2">{formatNumber(run.pnl_median)}</td>
              <td className="text-left p-2 text-xs">{formatDate(run.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

