'use client';

import { useOptimizations } from '@/lib/hooks/use-optimizations';
import { formatPercent } from '@/lib/utils/formatters';
import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function Optimizations() {
  const { data: optimizations = [], isLoading } = useOptimizations();

  // Group by caller for better organization
  const grouped = useMemo(() => {
    return optimizations.reduce((acc, opt) => {
      const key = opt.caller || 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(opt);
      return acc;
    }, {} as Record<string, typeof optimizations>);
  }, [optimizations]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-2">Past Optimizations</h2>
        <p className="text-slate-400 text-sm">Consolidated performance metrics from all optimization runs</p>
      </div>

      {isLoading ? (
        <div className="text-white p-8 text-center">Loading optimizations...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([caller, opts]) => (
            <div key={caller} className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="p-4 border-b border-slate-700">
                <h3 className="text-lg font-semibold text-white">{caller}</h3>
                <p className="text-sm text-slate-400">{opts.length} optimization results</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Total Return %</TableHead>
                      <TableHead>Win Rate %</TableHead>
                      <TableHead>Total Trades</TableHead>
                      <TableHead>Max Drawdown %</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                          No optimization results found
                        </TableCell>
                      </TableRow>
                    ) : (
                      opts.map((opt, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-white">{opt.strategy || 'N/A'}</TableCell>
                          <TableCell className={opt.totalReturn && opt.totalReturn > 0 ? 'text-green-400' : 'text-red-400'}>
                            {formatPercent(opt.totalReturn)}
                          </TableCell>
                          <TableCell className="text-white">{formatPercent(opt.winRate)}</TableCell>
                          <TableCell className="text-white">{opt.totalTrades || 'N/A'}</TableCell>
                          <TableCell className="text-red-400">{formatPercent(opt.maxDrawdown)}</TableCell>
                          <TableCell className="text-slate-400 text-sm">{opt.file}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

