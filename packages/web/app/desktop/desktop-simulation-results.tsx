'use client';

/**
 * Desktop Simulation Results
 * ==========================
 * Desktop-optimized results view with:
 * - Data table
 * - Charts and visualizations
 * - Detailed analysis
 * - Export functionality
 */

import { useState, useEffect } from 'react';
import { ArrowLeft, Download, Filter, Search, TrendingUp, TrendingDown } from 'lucide-react';

interface DesktopSimulationResultsProps {
  user: { id: number; name: string } | null;
  onBack: () => void;
}

export function DesktopSimulationResults({ user, onBack }: DesktopSimulationResultsProps) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'profit' | 'loss'>('all');

  useEffect(() => {
    loadResults();
  }, []);

  const loadResults = async () => {
    try {
      const response = await fetch(`/api/miniapp/results?userId=${user?.id}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        setResults(data.data || []);
      }
    } catch (err) {
      console.error('Failed to load results:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = results.filter((result) => {
    const matchesSearch = !searchQuery || 
      (result.token_symbol || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (result.mint || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filter === 'all' ||
      (filter === 'profit' && result.finalPnl >= 0) ||
      (filter === 'loss' && result.finalPnl < 0);

    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading results...</p>
        </div>
      </div>
    );
  }

  if (selectedResult) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setSelectedResult(null)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-slate-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Simulation Details</h1>
            <p className="text-slate-400">{selectedResult.token_symbol || selectedResult.mint}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Performance Metrics */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Performance</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-slate-400 mb-1">Final PnL</div>
                  <div className={`text-3xl font-bold ${selectedResult.finalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {selectedResult.finalPnl >= 0 ? '+' : ''}{(selectedResult.finalPnl * 100).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-400 mb-1">Entry Price</div>
                  <div className="text-xl font-semibold text-white">
                    ${selectedResult.entryPrice?.toFixed(8) || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-400 mb-1">Final Price</div>
                  <div className="text-xl font-semibold text-white">
                    ${selectedResult.finalPrice?.toFixed(8) || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-400 mb-1">Duration</div>
                  <div className="text-xl font-semibold text-white">
                    {selectedResult.duration ? `${selectedResult.duration}h` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Events Timeline */}
            {selectedResult.events && selectedResult.events.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Events Timeline</h2>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {selectedResult.events.map((event: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-4 bg-slate-900/50 border border-slate-700 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-white">{event.type}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(event.timestamp * 1000).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400">{event.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-slate-400 mb-4">Token Information</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-slate-400 mb-1">Symbol</div>
                  <div className="text-white font-medium">{selectedResult.token_symbol || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-slate-400 mb-1">Mint Address</div>
                  <div className="text-white font-mono text-xs break-all">{selectedResult.mint || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-slate-400 mb-1">Started</div>
                  <div className="text-white">
                    {new Date(selectedResult.created_at || selectedResult.start_time).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                // TODO: Implement export
                console.log('Export result:', selectedResult);
              }}
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export Results
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Simulation Results</h1>
          <p className="text-slate-400">View and analyze your backtest results</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Total Results</div>
            <div className="text-lg font-bold text-white">{filteredResults.length}</div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by token symbol or mint..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('profit')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'profit'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Profit
          </button>
          <button
            onClick={() => setFilter('loss')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'loss'
                ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Loss
          </button>
        </div>
      </div>

      {/* Results Table */}
      {filteredResults.length === 0 ? (
        <div className="text-center py-16 bg-slate-800 border border-slate-700 rounded-xl">
          <p className="text-slate-400 mb-4">No results found</p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium text-white"
          >
            Start a Backtest
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50 border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Token
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Entry Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Final Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    PnL
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredResults.map((result, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-900/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedResult(result)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-white">
                        {result.token_symbol || result.mint?.substring(0, 8)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                      {new Date(result.created_at || result.start_time).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-mono">
                      ${result.entryPrice?.toFixed(8) || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-mono">
                      ${result.finalPrice?.toFixed(8) || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`flex items-center gap-1 font-semibold ${
                        result.finalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {result.finalPnl >= 0 ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <TrendingDown className="h-4 w-4" />
                        )}
                        {result.finalPnl >= 0 ? '+' : ''}{(result.finalPnl * 100).toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedResult(result);
                        }}
                        className="text-indigo-400 hover:text-indigo-300"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

