'use client';

/**
 * Simulation Results View - New Design
 * ====================================
 * Enhanced simulation results interface with improved data visualization
 * and better organization of backtest results.
 */

import { useState } from 'react';
import { useSimulations } from '@/lib/hooks/use-simulations';
import { useSimulationDetails } from '@/lib/hooks/use-simulation-details';
import { formatNumber, formatPercent } from '@/lib/utils/formatters';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  DollarSign,
  Target,
  X,
  ExternalLink,
  Download
} from 'lucide-react';

interface SimulationCardProps {
  sim: {
    name: string;
    summary?: {
      finalPortfolio?: number;
      initialPortfolio?: number;
      totalTrades?: number;
      winRate?: number;
    };
    tradeHistoryPath?: string;
  };
  onClick: () => void;
}

function SimulationCard({ sim, onClick }: SimulationCardProps) {
  const returnPercent =
    sim.summary?.finalPortfolio && sim.summary?.initialPortfolio
      ? ((sim.summary.finalPortfolio / sim.summary.initialPortfolio) - 1) * 100
      : 0;

  const isPositive = returnPercent > 0;

  return (
    <div
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border border-slate-700 bg-slate-800/50 p-6 cursor-pointer transition-all duration-250 hover:border-slate-600 hover:shadow-lg hover:bg-slate-800"
    >
      {/* Status indicator */}
      <div
        className={`absolute top-0 right-0 w-1 h-full ${
          isPositive ? 'bg-emerald-500' : 'bg-red-500'
        }`}
      />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-slate-100 transition-colors">
              {sim.name}
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Calendar className="h-3 w-3" />
              <span>Completed</span>
            </div>
          </div>
          <div
            className={`px-3 py-1 rounded-full text-sm font-semibold ${
              isPositive
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {isPositive ? (
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {formatPercent(returnPercent)}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                {formatPercent(returnPercent)}
              </div>
            )}
          </div>
        </div>

        {/* Metrics Grid */}
        {sim.summary && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {sim.summary.totalTrades !== undefined && (
              <div>
                <div className="text-xs text-slate-400 mb-1">Trades</div>
                <div className="text-base font-semibold text-white">
                  {sim.summary.totalTrades}
                </div>
              </div>
            )}
            {sim.summary.winRate !== undefined && (
              <div>
                <div className="text-xs text-slate-400 mb-1">Win Rate</div>
                <div className="text-base font-semibold text-emerald-400">
                  {formatPercent(sim.summary.winRate)}
                </div>
              </div>
            )}
            {sim.summary.finalPortfolio && sim.summary.initialPortfolio && (
              <div>
                <div className="text-xs text-slate-400 mb-1">Final Value</div>
                <div className="text-base font-semibold text-white">
                  ${formatNumber(sim.summary.finalPortfolio)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-700">
          {sim.tradeHistoryPath && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <BarChart3 className="h-3 w-3" />
              <span>Trade history available</span>
            </div>
          )}
          <ExternalLink className="h-4 w-4 text-slate-500 group-hover:text-slate-400 transition-colors" />
        </div>
      </div>
    </div>
  );
}

export function SimulationResultsNew() {
  const [selectedSim, setSelectedSim] = useState<string | null>(null);
  const { data: simulations = [], isLoading } = useSimulations();
  const { data: simDetails, isLoading: loadingDetails } = useSimulationDetails({
    name: selectedSim,
    enabled: selectedSim !== null,
  });

  function handleSimulationClick(name: string) {
    setSelectedSim(name);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner text="Loading simulations..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Simulation Results</h1>
          <p className="text-slate-400">View and analyze past backtest performance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Total Simulations</div>
            <div className="text-lg font-bold text-white">{simulations.length}</div>
          </div>
        </div>
      </div>

      {/* Simulations Grid */}
      {simulations.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-slate-800/50 border border-slate-700 rounded-xl">
          <BarChart3 className="h-12 w-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Simulations Yet</h3>
          <p className="text-sm text-slate-400 text-center max-w-md">
            Start a new backtest to see results here. Simulations will appear once completed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {simulations.map((sim) => (
            <SimulationCard
              key={sim.name}
              sim={sim}
              onClick={() => handleSimulationClick(sim.name)}
            />
          ))}
        </div>
      )}

      {/* Details Panel */}
      {selectedSim && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          {/* Details Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700">
            <div>
              <h3 className="text-xl font-bold text-white mb-1">Simulation: {selectedSim}</h3>
              <p className="text-sm text-slate-400">Detailed performance analysis</p>
            </div>
            <button
              onClick={() => setSelectedSim(null)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          {/* Details Content */}
          <div className="p-6">
            {loadingDetails ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner text="Loading details..." />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary Cards */}
                {simDetails?.summary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(simDetails.summary).map(([key, value]) => (
                      <div
                        key={key}
                        className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"
                      >
                        <div className="text-xs text-slate-400 mb-1 capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </div>
                        <div className="text-lg font-semibold text-white">
                          {typeof value === 'number'
                            ? key.toLowerCase().includes('percent') || key.toLowerCase().includes('rate')
                              ? formatPercent(value)
                              : formatNumber(value)
                            : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Trade History */}
                {simDetails?.tradeHistory && simDetails.tradeHistory.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-white">Trade History</h4>
                      <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/10 transition-colors">
                        <Download className="h-4 w-4" />
                        Export
                      </button>
                    </div>
                    <div className="overflow-x-auto border border-slate-700 rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-900/50 border-b border-slate-700">
                            {Object.keys(simDetails.tradeHistory[0]).map((key) => (
                              <TableHead
                                key={key}
                                className="text-xs font-medium text-slate-400 uppercase tracking-wider"
                              >
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {simDetails.tradeHistory.slice(0, 100).map((trade: Record<string, unknown>, idx: number) => (
                            <TableRow
                              key={idx}
                              className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                            >
                              {Object.values(trade).map((value: unknown, valIdx: number) => (
                                <TableCell
                                  key={valIdx}
                                  className="text-sm text-slate-300 font-mono"
                                >
                                  {typeof value === 'number'
                                    ? formatNumber(value)
                                    : String(value)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {simDetails.tradeHistory.length > 100 && (
                        <div className="p-4 text-center text-sm text-slate-400 bg-slate-900/30">
                          Showing first 100 of {simDetails.tradeHistory.length} trades
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

