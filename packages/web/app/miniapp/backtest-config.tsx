'use client';

/**
 * Backtest Configuration Component
 * ================================
 * Allows users to configure and start a new backtest simulation.
 */

import { useState, useEffect } from 'react';
import { Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '@/lib/types/simulation';

interface BacktestConfigProps {
  user: { id: number; name: string } | null;
  telegram: any;
  onComplete: (result: any) => void;
  onBack: () => void;
}

export function BacktestConfig({ user, telegram, onComplete, onBack }: BacktestConfigProps) {
  const [step, setStep] = useState<'source' | 'mint' | 'strategy' | 'running'>('source');
  const [mint, setMint] = useState('');
  const [chain, setChain] = useState('solana');
  const [strategy, setStrategy] = useState<Strategy[]>([
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 },
  ]);
  const [stopLoss, setStopLoss] = useState<StopLossConfig>({ initial: -0.3, trailing: 0.5 });
  const [entryConfig, setEntryConfig] = useState<EntryConfig>({
    initialEntry: 'none',
    trailingEntry: 'none',
    maxWaitTime: 60,
  });
  const [reEntryConfig, setReEntryConfig] = useState<ReEntryConfig>({
    trailingReEntry: 'none',
    maxReEntries: 0,
    sizePercent: 0.5,
  });
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [recentBacktests, setRecentBacktests] = useState<any[]>([]);

  useEffect(() => {
    if (step === 'source') {
      loadRecentData();
    }
  }, [step]);

  const loadRecentData = async () => {
    try {
      // Load recent calls
      const callsRes = await fetch('/api/recent-alerts?limit=10');
      if (callsRes.ok) {
        const callsData = await callsRes.json();
        setRecentCalls(callsData.data || []);
      }

      // Load recent backtests (if endpoint exists)
      // const backtestsRes = await fetch(`/api/simulations?userId=${user?.id}&limit=10`);
      // if (backtestsRes.ok) {
      //   const backtestsData = await backtestsRes.json();
      //   setRecentBacktests(backtestsData.data || []);
      // }
    } catch (err) {
      console.error('Failed to load recent data:', err);
    }
  };

  const handleSourceSelect = (source: 'manual' | 'recent_call' | 'recent_backtest', data?: any) => {
    if (source === 'recent_call' && data) {
      setMint(data.token_address || data.mint);
      setChain(data.chain || 'solana');
      setStartTime(new Date(data.alert_timestamp || data.call_timestamp * 1000).toISOString());
      setStep('strategy');
    } else if (source === 'recent_backtest' && data) {
      setMint(data.mint);
      setChain(data.chain || 'solana');
      setStartTime(data.start_time);
      setEndTime(data.end_time);
      if (data.strategy) {
        setStrategy(Array.isArray(data.strategy) ? data.strategy : JSON.parse(data.strategy));
      }
      setStep('strategy');
    } else {
      setStep('mint');
    }
    telegram.HapticFeedback.impactOccurred('light');
  };

  const handleMintSubmit = () => {
    if (!mint.trim()) {
      setError('Please enter a mint address');
      return;
    }
    setStep('strategy');
    telegram.HapticFeedback.impactOccurred('light');
  };

  const handleStartBacktest = async () => {
    if (!mint.trim()) {
      setError('Mint address is required');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('running');

    try {
      const response = await fetch('/api/miniapp/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          mint,
          chain,
          strategy,
          stopLoss,
          entryConfig,
          reEntryConfig,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to start backtest');
      }

      const result = await response.json();
      telegram.HapticFeedback.notificationOccurred('success');
      onComplete(result.data);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      telegram.HapticFeedback.notificationOccurred('error');
      setStep('strategy');
    } finally {
      setLoading(false);
    }
  };

  const addStrategyStep = () => {
    setStrategy([...strategy, { percent: 0, target: 1 }]);
  };

  const updateStrategyStep = (index: number, field: 'percent' | 'target', value: number) => {
    const updated = [...strategy];
    updated[index] = { ...updated[index], [field]: value };
    setStrategy(updated);
  };

  const removeStrategyStep = (index: number) => {
    setStrategy(strategy.filter((_, i) => i !== index));
  };

  return (
    <div className="p-4 space-y-4 max-h-screen overflow-y-auto">
      {step === 'source' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold mb-4">Select Backtest Source</h2>

          {recentCalls.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-[var(--tg-theme-hint-color)]">Recent Calls</h3>
              <div className="space-y-2">
                {recentCalls.slice(0, 5).map((call, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSourceSelect('recent_call', call)}
                    className="w-full p-3 bg-[var(--tg-theme-button-color)] bg-opacity-10 rounded-lg text-left"
                  >
                    <div className="font-semibold">{call.token_symbol || 'Unknown'}</div>
                    <div className="text-xs text-[var(--tg-theme-hint-color)] truncate">
                      {call.token_address || call.mint}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => handleSourceSelect('manual')}
            className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold"
          >
            ✍️ Enter Mint Manually
          </button>
        </div>
      )}

      {step === 'mint' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold mb-4">Enter Token Details</h2>

          <div>
            <label className="block text-sm font-semibold mb-2">Mint Address</label>
            <input
              type="text"
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              placeholder="0x..."
              className="w-full p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg border border-[var(--tg-theme-hint-color)] border-opacity-20"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Chain</label>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="w-full p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg border border-[var(--tg-theme-hint-color)] border-opacity-20"
            >
              <option value="solana">Solana</option>
              <option value="ethereum">Ethereum</option>
              <option value="bsc">BSC</option>
              <option value="base">Base</option>
            </select>
          </div>

          {error && (
            <div className="p-3 bg-red-500 bg-opacity-20 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleMintSubmit}
            className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold"
          >
            Continue to Strategy
          </button>
        </div>
      )}

      {step === 'strategy' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold mb-4">Configure Strategy</h2>

          <div>
            <label className="block text-sm font-semibold mb-2">Take Profit Steps</label>
            <div className="space-y-2">
              {strategy.map((step, idx) => (
                <div key={idx} className="flex gap-2 items-center p-2 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={step.percent}
                    onChange={(e) => updateStrategyStep(idx, 'percent', parseFloat(e.target.value))}
                    placeholder="%"
                    className="flex-1 p-2 bg-transparent border border-[var(--tg-theme-hint-color)] border-opacity-20 rounded"
                  />
                  <span className="text-[var(--tg-theme-hint-color)]">at</span>
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    value={step.target}
                    onChange={(e) => updateStrategyStep(idx, 'target', parseFloat(e.target.value))}
                    placeholder="x"
                    className="flex-1 p-2 bg-transparent border border-[var(--tg-theme-hint-color)] border-opacity-20 rounded"
                  />
                  <button
                    onClick={() => removeStrategyStep(idx)}
                    className="p-2 text-red-500"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={addStrategyStep}
                className="w-full p-2 border border-[var(--tg-theme-button-color)] border-dashed rounded-lg text-[var(--tg-theme-button-color)]"
              >
                + Add Step
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Stop Loss</label>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--tg-theme-hint-color)]">Initial (%)</label>
                <input
                  type="number"
                  min="-0.99"
                  max="0"
                  step="0.01"
                  value={stopLoss.initial}
                  onChange={(e) => setStopLoss({ ...stopLoss, initial: parseFloat(e.target.value) })}
                  className="w-full p-2 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded border border-[var(--tg-theme-hint-color)] border-opacity-20"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--tg-theme-hint-color)]">Trailing (%)</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={stopLoss.trailing === 'none' ? 0 : stopLoss.trailing}
                  onChange={(e) => setStopLoss({ ...stopLoss, trailing: parseFloat(e.target.value) || 'none' })}
                  className="w-full p-2 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded border border-[var(--tg-theme-hint-color)] border-opacity-20"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500 bg-opacity-20 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleStartBacktest}
            disabled={loading}
            className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Starting...' : '🚀 Start Backtest'}
          </button>
        </div>
      )}

      {step === 'running' && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--tg-theme-button-color)] mx-auto mb-4"></div>
          <p>Running simulation...</p>
          <p className="text-sm text-[var(--tg-theme-hint-color)] mt-2">This may take a moment</p>
        </div>
      )}
    </div>
  );
}

