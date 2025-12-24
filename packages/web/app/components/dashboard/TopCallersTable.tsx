'use client';

import { formatPercent, formatMultiple } from '../../lib/format';
import type { CallerMetrics } from '../../lib/types';
import Link from 'next/link';

interface TopCallersTableProps {
  callers: CallerMetrics[];
}

export function TopCallersTable({ callers }: TopCallersTableProps) {
  if (callers.length === 0) {
    return <p className="text-muted-foreground">No caller data available</p>;
  }

  // Show top 10
  const topCallers = callers.slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Caller</th>
              <th className="text-right p-2">Calls</th>
              <th className="text-right p-2">Win Rate</th>
              <th className="text-right p-2">Avg Multiple</th>
            </tr>
          </thead>
          <tbody>
            {topCallers.map((caller) => (
              <tr key={caller.callerName} className="border-b hover:bg-muted/50 transition-colors">
                <td className="p-2 font-medium">
                  <Link
                    href={`/callers?caller=${encodeURIComponent(caller.callerName)}`}
                    className="hover:text-primary hover:underline"
                  >
                    {caller.callerName}
                  </Link>
                </td>
                <td className="text-right p-2">{caller.totalCalls.toLocaleString()}</td>
                <td className="text-right p-2">{formatPercent(caller.winRate)}</td>
                <td className="text-right p-2 font-semibold">{formatMultiple(caller.avgMultiple)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {callers.length > 10 && (
        <div className="text-center pt-2">
          <Link
            href="/callers"
            className="text-sm text-primary hover:underline"
          >
            View all {callers.length} callers →
          </Link>
        </div>
      )}
    </div>
  );
}

