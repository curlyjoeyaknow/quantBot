'use client';

import { useState } from 'react';
import { useSimulations } from '@/lib/hooks/use-simulations';
import { useSimulationDetails } from '@/lib/hooks/use-simulation-details';
import { formatNumber, formatPercent } from '@/lib/utils/formatters';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function Simulations() {
  const [selectedSim, setSelectedSim] = useState<string | null>(null);
  const { data: simulations = [], isLoading } = useSimulations();
  const { data: simDetails, isLoading: loadingDetails } = useSimulationDetails({
    name: selectedSim,
    enabled: selectedSim !== null,
  });

  function handleSimulationClick(name: string) {
    setSelectedSim(name);
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-2">Past Simulations</h2>
        <p className="text-slate-400 text-sm">View simulation results and trade history</p>
      </div>

      {isLoading ? (
        <div className="text-white p-8 text-center">Loading simulations...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {simulations.map((sim) => (
            <div
              key={sim.name}
              className="bg-slate-800 rounded-lg p-4 border border-slate-700 cursor-pointer hover:border-slate-600 transition-colors"
              onClick={() => handleSimulationClick(sim.name)}
            >
              <h3 className="text-lg font-semibold text-white mb-2">{sim.name}</h3>
              {sim.summary && (
                <div className="space-y-1 text-sm text-slate-400">
                  {sim.summary.finalPortfolio && sim.summary.initialPortfolio && (
                    <div>
                      Return: {formatPercent(((sim.summary.finalPortfolio / sim.summary.initialPortfolio) - 1) * 100)}
                    </div>
                  )}
                  {sim.summary.totalTrades && (
                    <div>Total Trades: {sim.summary.totalTrades}</div>
                  )}
                  {sim.summary.winRate !== undefined && (
                    <div>Win Rate: {formatPercent(sim.summary.winRate)}</div>
                  )}
                </div>
              )}
              {sim.tradeHistoryPath && (
                <div className="mt-2 text-xs text-slate-500">
                  Trade history available
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedSim && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-white">Simulation: {selectedSim}</h3>
            <button
              onClick={() => {
                setSelectedSim(null);
              }}
              className="text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          {loadingDetails ? (
            <div className="text-white p-8 text-center">Loading details...</div>
          ) : (
            <div className="space-y-4">
              {simDetails?.summary && (
                <div className="bg-slate-900 rounded p-4">
                  <h4 className="text-lg font-semibold text-white mb-2">Summary</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {Object.entries(simDetails.summary).map(([key, value]) => (
                      <div key={key}>
                        <div className="text-slate-400">{key}</div>
                        <div className="text-white">
                          {typeof value === 'number' ? formatNumber(value) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {simDetails?.tradeHistory && simDetails.tradeHistory.length > 0 && (
                <div>
                  <h4 className="text-lg font-semibold text-white mb-2">Trade History</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {Object.keys(simDetails.tradeHistory[0]).map((key) => (
                            <TableHead key={key}>{key}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {simDetails.tradeHistory.slice(0, 100).map((trade: Record<string, unknown>, idx: number) => (
                          <TableRow key={idx}>
                            {Object.values(trade).map((value: unknown, valIdx: number) => (
                              <TableCell key={valIdx} className="text-white text-sm">
                                {typeof value === 'number' ? formatNumber(value) : String(value)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {simDetails.tradeHistory.length > 100 && (
                      <div className="p-4 text-center text-slate-400 text-sm">
                        Showing first 100 of {simDetails.tradeHistory.length} trades
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

