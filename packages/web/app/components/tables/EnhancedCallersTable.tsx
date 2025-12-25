'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatPercent, formatMultiple, formatDate } from '../../lib/format';
import type { CallerMetrics } from '../../lib/types';
import { SearchInput } from '../ui/SearchInput';
import { Pagination } from '../ui/Pagination';
import { ExportButton } from '../ui/ExportButton';
import { TableSkeleton } from '../ui/Skeleton';

interface EnhancedCallersTableProps {
  callers: CallerMetrics[];
  isLoading?: boolean;
}

type SortField = 'callerName' | 'totalCalls' | 'winRate' | 'avgMultiple' | 'bestMultiple';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 20;

export function EnhancedCallersTable({ callers, isLoading = false }: EnhancedCallersTableProps) {
  const [sortField, setSortField] = useState<SortField>('totalCalls');
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
    setCurrentPage(1); // Reset to first page on sort
  };

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let filtered = callers;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (caller) =>
          caller.callerName.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case 'callerName':
          aVal = a.callerName;
          bVal = b.callerName;
          break;
        case 'totalCalls':
          aVal = a.totalCalls;
          bVal = b.totalCalls;
          break;
        case 'winRate':
          aVal = a.winRate;
          bVal = b.winRate;
          break;
        case 'avgMultiple':
          aVal = a.avgMultiple;
          bVal = b.avgMultiple;
          break;
        case 'bestMultiple':
          aVal = a.bestMultiple;
          bVal = b.bestMultiple;
          break;
        default:
          return 0;
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
  }, [callers, searchQuery, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedCallers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSorted.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  // Prepare export data
  const exportData = useMemo(() => {
    return filteredAndSorted.map((caller) => ({
      Caller: caller.callerName,
      'Total Calls': caller.totalCalls,
      'Win Rate': `${(caller.winRate * 100).toFixed(2)}%`,
      'Avg Multiple': caller.avgMultiple.toFixed(2),
      'Best Multiple': caller.bestMultiple.toFixed(2),
      'Worst Multiple': caller.worstMultiple.toFixed(2),
      'First Call': caller.firstCall instanceof Date ? caller.firstCall.toISOString() : caller.firstCall,
      'Last Call': caller.lastCall instanceof Date ? caller.lastCall.toISOString() : caller.lastCall,
    }));
  }, [filteredAndSorted]);

  if (isLoading) {
    return <TableSkeleton rows={10} cols={8} />;
  }

  if (callers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No caller data available</p>
        <p className="text-sm text-muted-foreground mt-2">
          Make sure you have ingested call data using the CLI ingestion commands.
        </p>
      </div>
    );
  }

  // Check if all callers have the same avgMultiple (likely data issue)
  const uniqueMultiples = new Set(callers.map(c => c.avgMultiple.toFixed(2)));
  const hasDataIssue = uniqueMultiples.size === 1 && callers.length > 1;

  return (
    <div className="space-y-4">
      {hasDataIssue && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            ⚠️ Warning: All callers show the same average multiple ({callers[0]?.avgMultiple.toFixed(2)}x). 
            This may indicate missing or incomplete data. Check that calls have been properly ingested with ATH data.
          </p>
        </div>
      )}
      
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md">
          <SearchInput
            placeholder="Search callers..."
            onSearch={setSearchQuery}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filteredAndSorted.length} caller{filteredAndSorted.length !== 1 ? 's' : ''}
          </span>
          <ExportButton data={exportData} filename="callers" format="csv" />
          <ExportButton data={exportData} filename="callers" format="json" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th
                className="text-left p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('callerName')}
              >
                <div className="flex items-center gap-2">
                  Caller
                  {sortField === 'callerName' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('totalCalls')}
              >
                <div className="flex items-center justify-end gap-2">
                  Total Calls
                  {sortField === 'totalCalls' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('winRate')}
              >
                <div className="flex items-center justify-end gap-2">
                  Win Rate
                  {sortField === 'winRate' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('avgMultiple')}
              >
                <div className="flex items-center justify-end gap-2">
                  Avg Multiple
                  {sortField === 'avgMultiple' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="text-right p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('bestMultiple')}
              >
                <div className="flex items-center justify-end gap-2">
                  Best Multiple
                  {sortField === 'bestMultiple' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="text-right p-3">Worst Multiple</th>
              <th className="text-left p-3">First Call</th>
              <th className="text-left p-3">Last Call</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCallers.map((caller) => (
              <tr key={caller.callerName} className="border-b hover:bg-muted/50 transition-colors">
                <td className="p-3 font-medium">
                  <Link
                    href={`/callers/${encodeURIComponent(caller.callerName)}`}
                    className="hover:text-primary hover:underline"
                  >
                    {caller.callerName}
                  </Link>
                </td>
                <td className="text-right p-3">{caller.totalCalls.toLocaleString()}</td>
                <td className="text-right p-3">{formatPercent(caller.winRate)}</td>
                <td className="text-right p-3 font-semibold">{formatMultiple(caller.avgMultiple)}</td>
                <td className="text-right p-3 text-green-600 dark:text-green-400">
                  {formatMultiple(caller.bestMultiple)}
                </td>
                <td className="text-right p-3 text-red-600 dark:text-red-400">
                  {formatMultiple(caller.worstMultiple)}
                </td>
                <td className="text-left p-3 text-xs text-muted-foreground">
                  {formatDate(caller.firstCall)}
                </td>
                <td className="text-left p-3 text-xs text-muted-foreground">
                  {formatDate(caller.lastCall)}
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
