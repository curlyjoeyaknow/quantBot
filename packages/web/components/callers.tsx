'use client';

import { useCallerStats } from '@/lib/hooks/use-caller-stats';
import { formatDate, formatAbbreviated, formatPercent } from '@/lib/utils/formatters';
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
                    <TableHead className="text-white text-right">Total Calls</TableHead>
                    <TableHead className="text-white text-right">Win Rate</TableHead>
                    <TableHead className="text-white text-right">Avg Multiple</TableHead>
                    <TableHead className="text-white text-right">Best Multiple</TableHead>
                    <TableHead className="text-white text-right">Total Return</TableHead>
                    <TableHead className="text-white text-right">Profitable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.callers.map((caller) => (
                    <TableRow key={caller.name}>
                      <TableCell className="text-white font-medium">{caller.name}</TableCell>
                      <TableCell className="text-slate-300 text-right">{caller.totalCalls.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-semibold ${
                        caller.winRate && caller.winRate >= 80 ? 'text-green-400' : 
                        caller.winRate && caller.winRate >= 60 ? 'text-yellow-400' : 
                        'text-red-400'
                      }`}>
                        {caller.winRate !== null && caller.winRate !== undefined 
                          ? formatPercent(caller.winRate / 100) 
                          : 'N/A'}
                      </TableCell>
                      <TableCell className="text-slate-300 text-right">
                        {caller.avgMultiple !== null && caller.avgMultiple !== undefined
                          ? `${caller.avgMultiple.toFixed(2)}x`
                          : 'N/A'}
                      </TableCell>
                      <TableCell className="text-green-400 text-right font-semibold">
                        {caller.bestMultiple !== null && caller.bestMultiple !== undefined
                          ? `${caller.bestMultiple.toFixed(2)}x`
                          : 'N/A'}
                      </TableCell>
                      <TableCell className="text-slate-300 text-right">
                        {caller.totalReturn !== null && caller.totalReturn !== undefined
                          ? `${caller.totalReturn.toFixed(2)}x`
                          : 'N/A'}
                      </TableCell>
                      <TableCell className="text-slate-300 text-right">
                        {caller.profitableCalls !== null && caller.profitableCalls !== undefined
                          ? `${caller.profitableCalls}/${caller.totalCalls}`
                          : 'N/A'}
                      </TableCell>
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

