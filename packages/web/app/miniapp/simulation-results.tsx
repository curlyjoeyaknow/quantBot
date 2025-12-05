'use client';

/**
 * Simulation Results Component
 * ===========================
 * Displays simulation results with charts and statistics.
 */

import { useState, useEffect } from 'react';

interface SimulationResultsProps {
  user: { id: number; name: string } | null;
  telegram: any;
  onBack: () => void;
}

export function SimulationResults({ user, telegram, onBack }: SimulationResultsProps) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  useEffect(() => {
    loadResults();
  }, []);

  const loadResults = async () => {
    try {
      // Load user's simulation results
      const response = await fetch(`/api/miniapp/results?userId=${user?.id}&limit=20`);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--tg-theme-button-color)] mx-auto mb-4"></div>
          <p>Loading results...</p>
        </div>
      </div>
    );
  }

  if (selectedResult) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold">Simulation Details</h2>

        <div className="space-y-3">
          <div className="p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
            <div className="text-sm text-[var(--tg-theme-hint-color)]">Token</div>
            <div className="font-semibold">{selectedResult.token_symbol || selectedResult.mint}</div>
          </div>

          <div className="p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
            <div className="text-sm text-[var(--tg-theme-hint-color)]">Final PnL</div>
            <div className={`font-bold text-2xl ${selectedResult.finalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {selectedResult.finalPnl >= 0 ? '+' : ''}{(selectedResult.finalPnl * 100).toFixed(2)}%
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
              <div className="text-sm text-[var(--tg-theme-hint-color)]">Entry Price</div>
              <div className="font-semibold">${selectedResult.entryPrice?.toFixed(8) || 'N/A'}</div>
            </div>
            <div className="p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
              <div className="text-sm text-[var(--tg-theme-hint-color)]">Final Price</div>
              <div className="font-semibold">${selectedResult.finalPrice?.toFixed(8) || 'N/A'}</div>
            </div>
          </div>

          {selectedResult.events && selectedResult.events.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Events</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {selectedResult.events.map((event: any, idx: number) => (
                  <div key={idx} className="p-2 bg-[var(--tg-theme-hint-color)] bg-opacity-5 rounded text-sm">
                    <div className="font-semibold">{event.type}</div>
                    <div className="text-[var(--tg-theme-hint-color)] text-xs">
                      {new Date(event.timestamp * 1000).toLocaleString()}
                    </div>
                    <div className="text-xs">{event.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setSelectedResult(null)}
            className="w-full p-3 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold"
          >
            ← Back to List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold mb-4">Simulation Results</h2>

      {results.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--tg-theme-hint-color)] mb-4">No results yet</p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg"
          >
            Start a Backtest
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((result, idx) => (
            <button
              key={idx}
              onClick={() => {
                telegram.HapticFeedback.impactOccurred('light');
                setSelectedResult(result);
              }}
              className="w-full p-4 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg text-left"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold">{result.token_symbol || result.mint?.substring(0, 8)}</div>
                  <div className="text-xs text-[var(--tg-theme-hint-color)]">
                    {new Date(result.created_at || result.start_time).toLocaleDateString()}
                  </div>
                </div>
                <div className={`font-bold ${result.finalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {result.finalPnl >= 0 ? '+' : ''}{(result.finalPnl * 100).toFixed(1)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

