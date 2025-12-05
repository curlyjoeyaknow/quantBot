'use client';

/**
 * Desktop Strategy Manager Component
 * Manages trading strategies for desktop view
 */

import { useState } from 'react';

interface Strategy {
  id: string;
  name: string;
  description?: string;
  strategy: Array<{ percent: number; target: number }>;
  stopLossConfig?: {
    initial: number;
    trailing: number | 'none';
  };
  isDefault?: boolean;
}

interface DesktopStrategyManagerProps {
  user: { id: number; name: string } | null;
  onBack: () => void;
}

export function DesktopStrategyManager({ user, onBack }: DesktopStrategyManagerProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Strategy Manager</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Create Strategy
        </button>
      </div>

      <div className="bg-slate-800 rounded-lg p-6">
        {strategies.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p>No strategies found. Create your first strategy to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {strategies.map((strategy) => (
              <div
                key={strategy.id}
                className="bg-slate-700 rounded-lg p-4 hover:bg-slate-600 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {strategy.name}
                      {strategy.isDefault && (
                        <span className="ml-2 text-xs bg-green-600 text-white px-2 py-1 rounded">
                          Default
                        </span>
                      )}
                    </h3>
                    {strategy.description && (
                      <p className="text-sm text-slate-300 mt-1">
                        {strategy.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button className="text-blue-400 hover:text-blue-300">
                      Edit
                    </button>
                    <button className="text-red-400 hover:text-red-300">
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400">Targets</p>
                    <p className="text-sm text-white">
                      {strategy.strategy.length} levels
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Stop Loss</p>
                    <p className="text-sm text-white">
                      {strategy.stopLossConfig
                        ? `${(strategy.stopLossConfig.initial * 100).toFixed(0)}%`
                        : 'Not set'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

