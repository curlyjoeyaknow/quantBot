'use client';

import { formatPercent, formatMultiple } from '../../lib/format';
import type { CallerMetrics } from '../../lib/types';

interface TopCallersTableProps {
  callers: CallerMetrics[];
}

export function TopCallersTable({ callers }: TopCallersTableProps) {
  if (callers.length === 0) {
    return <p className="text-muted-foreground">No caller data available</p>;
  }

  return (
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
          {callers.map((caller) => (
            <tr key={caller.callerName} className="border-b">
              <td className="p-2 font-medium">{caller.callerName}</td>
              <td className="text-right p-2">{caller.totalCalls}</td>
              <td className="text-right p-2">{formatPercent(caller.winRate)}</td>
              <td className="text-right p-2">{formatMultiple(caller.avgMultiple)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

