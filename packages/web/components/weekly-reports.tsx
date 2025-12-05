'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { DateTime } from 'luxon';

interface ReportGenerationOptions {
  strategyType: 'tenkan-kijun' | 'optimized';
  strategyName?: string;
  simulationTimestamp?: string;
  startDate: string;
  endDate: string;
  callers?: string[];
  outputDir?: string;
  runSimulationsIfMissing?: boolean;
  chain?: 'solana' | 'all';
}

interface ReportStatus {
  isRunning: boolean;
  progress?: {
    currentWeek?: string;
    totalWeeks?: number;
    completedWeeks?: number;
  };
  lastResult?: {
    success: boolean;
    reportsGenerated: number;
    outputDirectory: string;
    errors?: string[];
    warnings?: string[];
  };
}

export function WeeklyReports() {
  const [options, setOptions] = useState<ReportGenerationOptions>({
    strategyType: 'tenkan-kijun',
    startDate: '2025-09-01',
    endDate: DateTime.now().toFormat('yyyy-MM-dd'),
    chain: 'solana',
    runSimulationsIfMissing: false,
  });

  const [availableStrategies, setAvailableStrategies] = useState<Array<{
    name: string;
    displayName: string;
    timestamp?: string;
  }>>([]);

  // Fetch available strategies
  useEffect(() => {
    fetch('/api/reports/strategies')
      .then(res => res.json())
      .then(data => {
        if (data.strategies) {
          setAvailableStrategies(data.strategies);
        }
      })
      .catch(err => console.error('Failed to load strategies:', err));
  }, []);

  // Fetch report generation status
  const { data: reportStatus, refetch: refetchStatus } = useQuery<ReportStatus>({
    queryKey: ['report-generation-status'],
    queryFn: async () => {
      const res = await fetch('/api/reports/generate');
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as ReportStatus | undefined;
      return data?.isRunning ? 2000 : false;
    },
  });

  // Generate reports mutation
  const generateMutation = useMutation({
    mutationFn: async (opts: ReportGenerationOptions) => {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to generate reports');
      }
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
    },
  });

  const handleGenerate = () => {
    if (!options.startDate || !options.endDate) {
      alert('Please select start and end dates');
      return;
    }
    if (options.strategyType === 'optimized' && (!options.strategyName || !options.simulationTimestamp)) {
      alert('Please select a strategy and simulation timestamp for optimized strategies');
      return;
    }
    generateMutation.mutate(options);
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 className="text-2xl font-bold text-white mb-4">Weekly Report Generator</h2>
        <p className="text-slate-400 text-sm mb-6">
          Generate weekly HTML reports for different strategies and date ranges
        </p>

        {/* Strategy Type */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-white mb-2">
            Strategy Type
          </label>
          <select
            value={options.strategyType}
            onChange={(e) => setOptions({
              ...options,
              strategyType: e.target.value as 'tenkan-kijun' | 'optimized',
              strategyName: undefined,
              simulationTimestamp: undefined,
            })}
            className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600"
          >
            <option value="tenkan-kijun">Tenkan-Kijun (Weighted Portfolio)</option>
            <option value="optimized">Optimized Strategy</option>
          </select>
        </div>

        {/* Optimized Strategy Selection */}
        {options.strategyType === 'optimized' && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-white mb-2">
                Strategy
              </label>
              <select
                value={options.strategyName || ''}
                onChange={(e) => {
                  const strategy = availableStrategies.find(s => s.name === e.target.value);
                  setOptions({
                    ...options,
                    strategyName: e.target.value,
                    simulationTimestamp: strategy?.timestamp,
                  });
                }}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600"
              >
                <option value="">Select a strategy...</option>
                {availableStrategies.map(strategy => (
                  <option key={strategy.name} value={strategy.name}>
                    {strategy.displayName}
                  </option>
                ))}
              </select>
            </div>

            {options.strategyName && (
              <div className="mb-4 p-3 bg-slate-700 rounded text-sm text-slate-300">
                <strong>Simulation Timestamp:</strong> {options.simulationTimestamp || 'N/A'}
              </div>
            )}
          </>
        )}

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={options.startDate}
              onChange={(e) => setOptions({ ...options, startDate: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              End Date
            </label>
            <input
              type="date"
              value={options.endDate}
              onChange={(e) => setOptions({ ...options, endDate: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600"
            />
          </div>
        </div>

        {/* Chain Filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-white mb-2">
            Chain
          </label>
          <select
            value={options.chain}
            onChange={(e) => setOptions({ ...options, chain: e.target.value as 'solana' | 'all' })}
            className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600"
          >
            <option value="solana">Solana Only</option>
            <option value="all">All Chains</option>
          </select>
        </div>

        {/* Options */}
        <div className="mb-6">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={options.runSimulationsIfMissing || false}
              onChange={(e) => setOptions({ ...options, runSimulationsIfMissing: e.target.checked })}
              className="rounded border-slate-600 bg-slate-700"
            />
            <span className="text-sm text-white">
              Run simulations if missing data
            </span>
          </label>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={generateMutation.isPending || reportStatus?.isRunning}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded font-medium"
        >
          {generateMutation.isPending || reportStatus?.isRunning ? 'Generating...' : 'Generate Reports'}
        </button>
      </div>

      {/* Status */}
      {reportStatus && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">Generation Status</h3>
          
          {reportStatus.isRunning && (
            <div className="mb-4">
              <div className="flex items-center space-x-2 mb-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-white">Generating reports...</span>
              </div>
              {reportStatus.progress && (
                <div className="text-sm text-slate-400">
                  {reportStatus.progress.currentWeek && (
                    <div>Current Week: {reportStatus.progress.currentWeek}</div>
                  )}
                  {reportStatus.progress.completedWeeks !== undefined && reportStatus.progress.totalWeeks !== undefined && (
                    <div>
                      Progress: {reportStatus.progress.completedWeeks} / {reportStatus.progress.totalWeeks} weeks
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {reportStatus.lastResult && (
            <div className={`p-4 rounded ${reportStatus.lastResult.success ? 'bg-green-900/20 border border-green-700' : 'bg-red-900/20 border border-red-700'}`}>
              <div className="font-medium text-white mb-2">
                {reportStatus.lastResult.success ? '✅ Generation Complete' : '❌ Generation Failed'}
              </div>
              {reportStatus.lastResult.success && (
                <div className="text-sm text-slate-300">
                  <div>Reports Generated: {reportStatus.lastResult.reportsGenerated}</div>
                  <div>Output Directory: {reportStatus.lastResult.outputDirectory}</div>
                </div>
              )}
              {reportStatus.lastResult.errors && reportStatus.lastResult.errors.length > 0 && (
                <div className="mt-2 text-sm text-red-400">
                  <div className="font-medium">Errors:</div>
                  <ul className="list-disc list-inside">
                    {reportStatus.lastResult.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {reportStatus.lastResult.warnings && reportStatus.lastResult.warnings.length > 0 && (
                <div className="mt-2 text-sm text-yellow-400">
                  <div className="font-medium">Warnings:</div>
                  <ul className="list-disc list-inside">
                    {reportStatus.lastResult.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

