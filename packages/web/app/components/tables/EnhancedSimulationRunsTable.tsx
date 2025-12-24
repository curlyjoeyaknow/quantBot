'use client';

import { useState, useMemo } from 'react';
import { formatDate, formatNumber } from '../../lib/format';
import Link from 'next/link';
import { SearchInput } from '../ui/SearchInput';
import { Pagination } from '../ui/Pagination';
import { ExportButton } from '../ui/ExportButton';
import { TableSkeleton } from '../ui/Skeleton';

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

interface EnhancedSimulationRunsTableProps {
  runs: SimulationRun[];
  isLoading?: boolean;
}

type SortField =
  | 'run_id'
  | 'strategy_name'
  | 'caller_name'
  | 'created_at'
  | 'total_calls'
  | 'total_trades'
  | 'pnl_mean'
  | 'pnl_median';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 20;

export function EnhancedSimulationRunsTable({
  runs,
  isLoading = false,
}: EnhancedSimulationRunsTableProps) {
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let filtered = runs;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (run) =>
          run.run_id.toLowerCase().includes(query) ||
          run.strategy_name.toLowerCase().includes(query) ||
          (run.caller_name && run.caller_name.toLowerCase().includes(query))
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;

      switch (sortField) {
        case 'run_id':
          aVal = a.run_id;
          bVal = b.run_id;
          break;
        case 'strategy_name':
          aVal = a.strategy_name;
          bVal = b.strategy_name;
          break;
        case 'caller_name':
          aVal = a.caller_name || '';
          bVal = b.caller_name || '';
          break;
        case 'created_at':
          aVal = a.created_at;
          bVal = b.created_at;
          break;
        case 'total_calls':
          aVal = a.total_calls ?? 0;
          bVal = b.total_calls ?? 0;
          break;
        case 'total_trades':
          aVal = a.total_trades ?? 0;
          bVal = b.total_trades ?? 0;
          break;
        case 'pnl_mean':
          aVal = a.pnl_mean ?? 0;
          bVal = b.pnl_mean ?? 0;
          break;
        case 'pnl_median':
          aVal = a.pnl_median ?? 0;
          bVal = b.pnl_median ?? 0;
          break;
        default:
          return 0;
      }

      if (aVal === null || bVal === null) {
        if (aVal === null && bVal === null) return 0;
        return aVal === null ? 1 : -1;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return sorted;
  }, [runs, searchQuery, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedRuns = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSorted.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  // Prepare export data
  const exportData = useMemo(() => {
    return filteredAndSorted.map((run) => ({
      'Run ID': run.run_id,
      Strategy: run.strategy_name,
      Caller: run.caller_name || '-',
      'From': run.from_iso,
      'To': run.to_iso,
      'Total Calls': run.total_calls ?? 0,
      'Successful Calls': run.successful_calls ?? 0,
      'Failed Calls': run.failed_calls ?? 0,
      'Total Trades': run.total_trades ?? 0,
      'PnL Min': run.pnl_min ?? 0,
      'PnL Max': run.pnl_max ?? 0,
      'PnL Mean': run.pnl_mean ?? 0,
      'PnL Median': run.pnl_median ?? 0,
      'Created At': run.created_at,
    }));
  }, [filteredAndSorted]);

  if (isLoading) {
    return <TableSkeleton rows={10} cols={9} />;
  }

  if (runs.length === 0) {
    return <p className="text-muted-foreground">No simulation runs available</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md">
          <SearchInput
            placeholder="Search by run ID, strategy, or caller..."
            onSearch={setSearchQuery}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filteredAndSorted.length} run{filteredAndSorted.length !== 1 ? 's' : ''}
          </span>
          <ExportButton data={exportData} filename="simulation-runs" format="csv" />
          <ExportButton data={exportData} filename="simulation-runs" format="json" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th
                className="text-left p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('run_id')}
              >
                <div className="flex items-center gap-2">
                  Run ID
                  {sortField === 'run_id' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-left p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('strategy_name')}
              >
                <div className="flex items-center gap-2">
                  Strategy
                  {sortField === 'strategy_name' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-left p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('caller_name')}
              >
                <div className="flex items-center gap-2">
                  Caller
                  {sortField === 'caller_name' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="text-left p-3">Date Range</th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('total_calls')}
              >
                <div className="flex items-center justify-end gap-2">
                  Total Calls
                  {sortField === 'total_calls' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('total_trades')}
              >
                <div className="flex items-center justify-end gap-2">
                  Total Trades
                  {sortField === 'total_trades' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('pnl_mean')}
              >
                <div className="flex items-center justify-end gap-2">
                  PnL Mean
                  {sortField === 'pnl_mean' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('pnl_median')}
              >
                <div className="flex items-center justify-end gap-2">
                  PnL Median
                  {sortField === 'pnl_median' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-left p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('created_at')}
              >
                <div className="flex items-center gap-2">
                  Created
                  {sortField === 'created_at' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRuns.map((run) => (
              <tr key={run.run_id} className="border-b hover:bg-muted/50 transition-colors">
                <td className="p-3">
                  <Link
                    href={`/simulations/${run.run_id}`}
                    className="text-primary hover:underline font-mono text-xs"
                  >
                    {run.run_id.substring(0, 8)}...
                  </Link>
                </td>
                <td className="p-3 font-medium">{run.strategy_name}</td>
                <td className="p-3">{run.caller_name || '-'}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {formatDate(run.from_iso)} - {formatDate(run.to_iso)}
                </td>
                <td className="text-right p-3">{run.total_calls?.toLocaleString() ?? '-'}</td>
                <td className="text-right p-3">{run.total_trades?.toLocaleString() ?? '-'}</td>
                <td
                  className={`text-right p-3 font-semibold ${
                    (run.pnl_mean ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatNumber(run.pnl_mean)}
                </td>
                <td
                  className={`text-right p-3 font-semibold ${
                    (run.pnl_median ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatNumber(run.pnl_median)}
                </td>
                <td className="text-left p-3 text-xs text-muted-foreground">
                  {formatDate(run.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          itemsPerPage={ITEMS_PER_PAGE}
          totalItems={filteredAndSorted.length}
        />
      )}
    </div>
  );
}

