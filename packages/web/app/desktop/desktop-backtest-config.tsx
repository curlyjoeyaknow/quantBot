'use client';

/**
 * Desktop Backtest Configuration
 * ==============================
 * Desktop-optimized backtest configuration with:
 * - Multi-column layout
 * - Side-by-side form sections
 * - Better visualization
 * - Real-time validation
 */

import { useState, useEffect } from 'react';
import { Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '@/lib/types/simulation';
import { ArrowLeft, Plus, X, Play, Loader2 } from 'lucide-react';

interface DesktopBacktestConfigProps {
  user: { id: number; name: string } | null;
  onComplete: (result: any) => void;
  onBack: () => void;
}

export function DesktopBacktestConfig({ user, onComplete, onBack }: DesktopBacktestConfigProps) {
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

  useEffect(() => {
    if (step === 'source') {
      loadRecentData();
    }
  }, [step]);

  const loadRecentData = async () => {
    try {
      const callsRes = await fetch('/api/recent-alerts?limit=10');
      if (callsRes.ok) {
        const callsData = await callsRes.json();
        setRecentCalls(callsData.data || []);
      }
    } catch (err) {
      console.error('Failed to load recent data:', err);
    }
  };

  const handleSourceSelect = (source: 'manual' | 'recent_call', data?: any) => {
    if (source === 'recent_call' && data) {
      setMint(data.token_address || data.mint);
      setChain(data.chain || 'solana');
      setStartTime(new Date(data.alert_timestamp || data.call_timestamp * 1000).toISOString());
      setStep('strategy');
    } else {
      setStep('mint');
    }
  };

  const handleMintSubmit = () => {
    if (!mint.trim()) {
      setError('Please enter a mint address');
      return;
    }
    setStep('strategy');
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
      onComplete(result.data);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
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

  if (step === 'running') {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Running Simulation...</h3>
          <p className="text-slate-400">This may take a few moments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-slate-400" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">New Backtest</h1>
            <p className="text-slate-400 mt-1">Configure and run a simulation</p>
          </div>
        </div>
        {step !== 'source' && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className={`h-2 w-2 rounded-full ${step === 'mint' ? 'bg-indigo-500' : 'bg-slate-600'}`} />
            <span>Token</span>
            <div className={`h-2 w-2 rounded-full ${step === 'strategy' ? 'bg-indigo-500' : 'bg-slate-600'}`} />
            <span>Strategy</span>
          </div>
        )}
      </div>

      {/* Source Selection */}
      {step === 'source' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Calls */}
          {recentCalls.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Recent Calls</h2>
              <div className="space-y-3">
                {recentCalls.slice(0, 5).map((call, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSourceSelect('recent_call', call)}
                    className="w-full p-4 bg-slate-900/50 border border-slate-700 rounded-lg text-left hover:border-indigo-500 transition-colors"
                  >
                    <div className="font-semibold text-white">{call.token_symbol || 'Unknown'}</div>
                    <div className="text-xs text-slate-400 mt-1 truncate">
                      {call.token_address || call.mint}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manual Entry */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Manual Entry</h2>
            <button
              onClick={() => handleSourceSelect('manual')}
              className="w-full p-6 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold text-white transition-colors"
            >
              Enter Token Details Manually
            </button>
          </div>
        </div>
      )}

      {/* Mint Entry */}
      {step === 'mint' && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Mint Address</label>
              <input
                type="text"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                placeholder="Enter token mint address..."
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Chain</label>
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="solana">Solana</option>
                <option value="ethereum">Ethereum</option>
                <option value="bsc">BSC</option>
                <option value="base">Base</option>
              </select>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium text-white transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleMintSubmit}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium text-white transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Configuration */}
      {step === 'strategy' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Strategy Steps */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white mb-4">Take Profit Steps</h2>
            <div className="space-y-3">
              {strategy.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700 rounded-lg"
                >
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Percent</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={step.percent}
                        onChange={(e) => updateStrategyStep(idx, 'percent', parseFloat(e.target.value) || 0)}
                        className="w-full p-2 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Target (x)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={step.target}
                        onChange={(e) => updateStrategyStep(idx, 'target', parseFloat(e.target.value) || 1)}
                        className="w-full p-2 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                      />
                    </div>
                  </div>
                  {strategy.length > 1 && (
                    <button
                      onClick={() => removeStrategyStep(idx)}
                      className="p-2 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addStrategyStep}
                className="w-full p-3 border-2 border-dashed border-slate-700 rounded-lg text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Step
              </button>
            </div>
          </div>

          {/* Right Column - Stop Loss & Entry */}
          <div className="space-y-6">
            {/* Stop Loss */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">Stop Loss</h2>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Initial (%)</label>
                <input
                  type="number"
                  min="-0.99"
                  max="0"
                  step="0.01"
                  value={stopLoss.initial}
                  onChange={(e) => setStopLoss({ ...stopLoss, initial: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Trailing (%)</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={stopLoss.trailing === 'none' ? 0 : stopLoss.trailing}
                  onChange={(e) => setStopLoss({ ...stopLoss, trailing: parseFloat(e.target.value) || 'none' })}
                  className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
              </div>
            </div>

            {/* Token Info */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Token Information</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mint:</span>
                  <span className="text-white font-mono text-xs">{mint || 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Chain:</span>
                  <span className="text-white capitalize">{chain}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons for Strategy Step */}
      {step === 'strategy' && (
        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={() => setStep('mint')}
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium text-white transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleStartBacktest}
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Start Backtest
              </>
            )}
          </button>
        </div>
      )}

      {error && step === 'strategy' && (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

