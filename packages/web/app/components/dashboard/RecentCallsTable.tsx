'use client';

import { formatMultiple, formatDate } from '../../lib/format';
import type { CallPerformance } from '../../lib/types';

interface RecentCallsTableProps {
  calls: CallPerformance[];
}

export function RecentCallsTable({ calls }: RecentCallsTableProps) {
  if (calls.length === 0) {
    return <p className="text-muted-foreground">No recent calls available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left p-2">Token</th>
            <th className="text-left p-2">Caller</th>
            <th className="text-left p-2">Time</th>
            <th className="text-right p-2">ATH Multiple</th>
            <th className="text-right p-2">Time to ATH</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.callId} className="border-b">
              <td className="p-2 font-mono text-xs">
                {call.tokenAddress}...
              </td>
              <td className="p-2">{call.callerName}</td>
              <td className="p-2">{formatDate(call.alertTimestamp)}</td>
              <td className="text-right p-2">{formatMultiple(call.athMultiple)}</td>
              <td className="text-right p-2">
                {call.timeToAthMinutes > 0
                  ? `${Math.round(call.timeToAthMinutes)}m`
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

