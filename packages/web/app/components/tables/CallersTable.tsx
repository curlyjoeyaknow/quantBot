'use client';

import { useState } from 'react';
import { formatPercent, formatMultiple, formatDate } from '../../lib/format';
import type { CallerMetrics } from '../../lib/types';

interface CallersTableProps {
  callers: CallerMetrics[];
}

type SortField = 'callerName' | 'totalCalls' | 'winRate' | 'avgMultiple';
type SortDirection = 'asc' | 'desc';

export function CallersTable({ callers }: CallersTableProps) {
  const [sortField, setSortField] = useState<SortField>('totalCalls');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedCallers = [...callers].sort((a, b) => {
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

  if (callers.length === 0) {
    return <p className="text-muted-foreground">No caller data available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th
              className="text-left p-2 cursor-pointer hover:bg-muted"
              onClick={() => handleSort('callerName')}
            >
              Caller
              {sortField === 'callerName' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th
              className="text-right p-2 cursor-pointer hover:bg-muted"
              onClick={() => handleSort('totalCalls')}
            >
              Total Calls
              {sortField === 'totalCalls' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th
              className="text-right p-2 cursor-pointer hover:bg-muted"
              onClick={() => handleSort('winRate')}
            >
              Win Rate
              {sortField === 'winRate' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th
              className="text-right p-2 cursor-pointer hover:bg-muted"
              onClick={() => handleSort('avgMultiple')}
            >
              Avg Multiple
              {sortField === 'avgMultiple' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th className="text-right p-2">Best Multiple</th>
            <th className="text-right p-2">Worst Multiple</th>
            <th className="text-left p-2">First Call</th>
            <th className="text-left p-2">Last Call</th>
          </tr>
        </thead>
        <tbody>
          {sortedCallers.map((caller) => (
            <tr key={caller.callerName} className="border-b hover:bg-muted/50">
              <td className="p-2 font-medium">{caller.callerName}</td>
              <td className="text-right p-2">{caller.totalCalls}</td>
              <td className="text-right p-2">{formatPercent(caller.winRate)}</td>
              <td className="text-right p-2">{formatMultiple(caller.avgMultiple)}</td>
              <td className="text-right p-2">{formatMultiple(caller.bestMultiple)}</td>
              <td className="text-right p-2">{formatMultiple(caller.worstMultiple)}</td>
              <td className="text-left p-2">{formatDate(caller.firstCall)}</td>
              <td className="text-left p-2">{formatDate(caller.lastCall)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

