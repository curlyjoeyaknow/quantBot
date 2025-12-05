'use client';

import { useState } from 'react';
import { useRecentAlerts } from '@/lib/hooks/use-recent-alerts';
import { formatDate, formatCurrency, formatPercent } from '@/lib/utils/formatters';
import { CONSTANTS } from '@/lib/constants';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function RecentAlerts() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useRecentAlerts({ page });
  const pageSize = CONSTANTS.FRONTEND.RECENT_ALERTS_PAGE_SIZE;

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-2">Recent Alerts (Past Week)</h2>
        <p className="text-slate-400 text-sm">All alerts from the past 7 days with current price and gain/loss</p>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="mt-4 text-white">Loading recent alerts...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Alert Time</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Market Cap</TableHead>
                  <TableHead>Max Price</TableHead>
                  <TableHead>Max Gain %</TableHead>
                  <TableHead>Time to ATH</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>Current Gain/Loss %</TableHead>
                  <TableHead>Duplicate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!data?.data || data.data.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-slate-400 py-8">
                      No recent alerts found
                    </TableCell>
                  </TableRow>
                ) : (
                  data.data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-white">{row.callerName}</TableCell>
                      <TableCell className="text-white">
                        {row.tokenSymbol || row.tokenAddress.slice(0, 8) + '...'}
                      </TableCell>
                      <TableCell className="text-slate-400">{formatDate(row.alertTimestamp)}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.entryPrice, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.marketCapAtCall)}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.maxPrice, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}</TableCell>
                      <TableCell className={row.maxGainPercent && row.maxGainPercent > 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatPercent(row.maxGainPercent)}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {row.timeToATH !== null ? `${row.timeToATH}m` : 'N/A'}
                      </TableCell>
                      <TableCell className="text-white">{formatCurrency(row.currentPrice, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}</TableCell>
                      <TableCell className={row.currentGainPercent && row.currentGainPercent > 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatPercent(row.currentGainPercent)}
                      </TableCell>
                      <TableCell className="text-white">
                        {row.isDuplicate ? 'Yes' : 'No'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && data && data.data.length > 0 && (
          <div className="p-4 border-t border-slate-700 flex items-center justify-between">
            <div className="text-slate-400">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data.total || 0)} of {data.total || 0} results
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 bg-slate-700 text-white rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                  disabled={page * pageSize >= (data?.total || 0)}
                className="px-4 py-2 bg-slate-700 text-white rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

