'use client';

import { useState } from 'react';
import { useCallerHistory } from '@/lib/hooks/use-caller-history';
import { useCallers } from '@/lib/hooks/use-callers';
import { formatDate, formatCurrency, formatPercent } from '@/lib/utils/formatters';
import { CallerHistoryFilters } from '@/lib/types';
import { CONSTANTS } from '@/lib/constants';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function CallerHistory() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CallerHistoryFilters>({
    caller: '',
    startDate: '',
    endDate: '',
    minMarketCap: '',
    maxMarketCap: '',
    minMaxGain: '',
    maxMaxGain: '',
    isDuplicate: '',
  });

  const { data: callersData = [] } = useCallers();
  const { data, isLoading } = useCallerHistory({ page, filters });

  const pageSize = CONSTANTS.FRONTEND.DEFAULT_PAGE_SIZE;

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Caller</label>
            <select
              value={filters.caller}
              onChange={(e) => setFilters({ ...filters, caller: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
            >
              <option value="">All</option>
              {callersData.map((caller) => (
                <option key={caller} value={caller}>
                  {caller}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Min Market Cap</label>
            <input
              type="number"
              value={filters.minMarketCap}
              onChange={(e) => setFilters({ ...filters, minMarketCap: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
              placeholder="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Max Market Cap</label>
            <input
              type="number"
              value={filters.maxMarketCap}
              onChange={(e) => setFilters({ ...filters, maxMarketCap: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
              placeholder="∞"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Min Max Gain %</label>
            <input
              type="number"
              value={filters.minMaxGain}
              onChange={(e) => setFilters({ ...filters, minMaxGain: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
              placeholder="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Max Max Gain %</label>
            <input
              type="number"
              value={filters.maxMaxGain}
              onChange={(e) => setFilters({ ...filters, maxMaxGain: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
              placeholder="∞"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Duplicate</label>
            <select
              value={filters.isDuplicate}
              onChange={(e) => setFilters({ ...filters, isDuplicate: e.target.value })}
              className="w-full bg-slate-700 text-white rounded px-3 py-2"
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="mt-4 text-white">Loading caller history...</p>
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <p>No data found matching your filters.</p>
            <p className="text-sm mt-2">Try adjusting your filter criteria.</p>
          </div>
        ) : (
          <>
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
                    <TableHead>Duplicate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.data || []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-white">{row.callerName}</TableCell>
                      <TableCell className="text-white">
                        {row.tokenSymbol || row.tokenAddress.slice(0, 8) + '...'}
                      </TableCell>
                      <TableCell className="text-slate-400">{formatDate(row.alertTimestamp)}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.entryPrice)}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.marketCapAtCall)}</TableCell>
                      <TableCell className="text-white">{formatCurrency(row.maxPrice)}</TableCell>
                      <TableCell className={row.maxGainPercent && row.maxGainPercent > 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatPercent(row.maxGainPercent)}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {row.timeToATH !== null ? `${row.timeToATH}m` : 'N/A'}
                      </TableCell>
                      <TableCell className="text-white">
                        {row.isDuplicate ? 'Yes' : 'No'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="p-4 border-t border-slate-700 flex items-center justify-between">
              <div className="text-slate-400">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data?.total || 0)} of {data?.total || 0} results
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
          </>
        )}
      </div>
    </div>
  );
}

