'use client';

import { useCallerStats } from '@/lib/hooks/use-caller-stats';
import { formatDate, formatAbbreviated } from '@/lib/utils/formatters';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function Callers() {
  const { data, isLoading } = useCallerStats();

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-2">Caller Statistics</h2>
        <p className="text-slate-400 text-sm">Performance metrics for all callers</p>
      </div>

      {isLoading ? (
        <div className="text-white p-8 text-center">Loading caller statistics...</div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Total Callers</div>
              <div className="text-2xl font-bold text-white">{data.totals.total_callers}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Total Calls</div>
              <div className="text-2xl font-bold text-white">{data.totals.total_calls.toLocaleString()}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Unique Tokens</div>
              <div className="text-2xl font-bold text-white">{data.totals.total_tokens.toLocaleString()}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Date Range</div>
              <div className="text-sm text-white">
                {formatDate(data.totals.earliest_call)} - {formatDate(data.totals.latest_call)}
              </div>
            </div>
          </div>

          {/* Callers Table */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-white">Caller</TableHead>
                    <TableHead className="text-white">Total Calls</TableHead>
                    <TableHead className="text-white">Unique Tokens</TableHead>
                    <TableHead className="text-white">First Call</TableHead>
                    <TableHead className="text-white">Last Call</TableHead>
                    <TableHead className="text-white">Avg Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.callers.map((caller) => (
                    <TableRow key={caller.name}>
                      <TableCell className="text-white font-medium">{caller.name}</TableCell>
                      <TableCell className="text-slate-300">{caller.totalCalls.toLocaleString()}</TableCell>
                      <TableCell className="text-slate-300">{caller.uniqueTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-slate-300">{formatDate(caller.firstCall)}</TableCell>
                      <TableCell className="text-slate-300">{formatDate(caller.lastCall)}</TableCell>
                      <TableCell className="text-slate-300">{formatAbbreviated(caller.avgPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-white p-8 text-center">No caller data available</div>
      )}
    </div>
  );
}

