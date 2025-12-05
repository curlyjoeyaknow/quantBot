'use client';

/**
 * Strategy Manager Component
 * ==========================
 * Allows users to view, create, edit, and delete trading strategies.
 */

import { useState, useEffect } from 'react';
import { Strategy } from '@/lib/types/simulation';

interface StrategyManagerProps {
  user: { id: number; name: string } | null;
  telegram: any;
  onBack: () => void;
}

export function StrategyManager({ user, telegram, onBack }: StrategyManagerProps) {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingStrategy, setEditingStrategy] = useState<any | null>(null);
  const [strategyName, setStrategyName] = useState('');
  const [strategy, setStrategy] = useState<Strategy[]>([
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 },
  ]);

  useEffect(() => {
    if (view === 'list') {
      loadStrategies();
    }
  }, [view]);

  const loadStrategies = async () => {
    try {
      const response = await fetch(`/api/miniapp/strategies?userId=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setStrategies(data.data || []);
      }
    } catch (err) {
      console.error('Failed to load strategies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (!strategyName.trim()) {
      telegram.showAlert('Please enter a strategy name');
      return;
    }

    try {
      const response = await fetch('/api/miniapp/strategies', {
        method: editingStrategy ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          name: strategyName,
          strategy,
          id: editingStrategy?.id,
        }),
      });

      if (response.ok) {
        telegram.HapticFeedback.notificationOccurred('success');
        setView('list');
        setStrategyName('');
        setStrategy([{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }]);
        setEditingStrategy(null);
      } else {
        throw new Error('Failed to save strategy');
      }
    } catch (err) {
      telegram.HapticFeedback.notificationOccurred('error');
      telegram.showAlert('Failed to save strategy');
    }
  };

  const handleDeleteStrategy = async (id: number) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      telegram.showConfirm('Are you sure you want to delete this strategy?', resolve);
    });

    if (!confirmed) return;

    try {
      const response = await fetch(`/api/miniapp/strategies?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        telegram.HapticFeedback.notificationOccurred('success');
        loadStrategies();
      } else {
        throw new Error('Failed to delete strategy');
      }
    } catch (err) {
      telegram.HapticFeedback.notificationOccurred('error');
      telegram.showAlert('Failed to delete strategy');
    }
  };

  if (loading && view === 'list') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--tg-theme-button-color)] mx-auto mb-4"></div>
          <p>Loading strategies...</p>
        </div>
      </div>
    );
  }

  if (view === 'create' || view === 'edit') {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold">{view === 'edit' ? 'Edit' : 'Create'} Strategy</h2>

        <div>
          <label className="block text-sm font-semibold mb-2">Strategy Name</label>
          <input
            type="text"
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            placeholder="My Strategy"
            className="w-full p-3 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg border border-[var(--tg-theme-hint-color)] border-opacity-20"
          />
        </div>

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
                  onChange={(e) => {
                    const updated = [...strategy];
                    updated[idx] = { ...updated[idx], percent: parseFloat(e.target.value) };
                    setStrategy(updated);
                  }}
                  className="flex-1 p-2 bg-transparent border border-[var(--tg-theme-hint-color)] border-opacity-20 rounded"
                />
                <span className="text-[var(--tg-theme-hint-color)]">at</span>
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={step.target}
                  onChange={(e) => {
                    const updated = [...strategy];
                    updated[idx] = { ...updated[idx], target: parseFloat(e.target.value) };
                    setStrategy(updated);
                  }}
                  className="flex-1 p-2 bg-transparent border border-[var(--tg-theme-hint-color)] border-opacity-20 rounded"
                />
                <button
                  onClick={() => setStrategy(strategy.filter((_, i) => i !== idx))}
                  className="p-2 text-red-500"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setStrategy([...strategy, { percent: 0, target: 1 }])}
              className="w-full p-2 border border-[var(--tg-theme-button-color)] border-dashed rounded-lg text-[var(--tg-theme-button-color)]"
            >
              + Add Step
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setView('list');
              setStrategyName('');
              setStrategy([{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }]);
              setEditingStrategy(null);
            }}
            className="flex-1 p-3 border border-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-color)] rounded-lg font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveStrategy}
            className="flex-1 p-3 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Strategies</h2>
        <button
          onClick={() => {
            setView('create');
            setStrategyName('');
            setStrategy([{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }]);
          }}
          className="px-4 py-2 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg text-sm font-semibold"
        >
          + New
        </button>
      </div>

      {strategies.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--tg-theme-hint-color)] mb-4">No strategies yet</p>
          <button
            onClick={() => setView('create')}
            className="px-4 py-2 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg"
          >
            Create Your First Strategy
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {strategies.map((strat) => (
            <div
              key={strat.id}
              className="p-4 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold">{strat.name}</div>
                  {strat.description && (
                    <div className="text-sm text-[var(--tg-theme-hint-color)]">{strat.description}</div>
                  )}
                </div>
                {strat.is_default && (
                  <span className="text-xs bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] px-2 py-1 rounded">
                    Default
                  </span>
                )}
              </div>

              <div className="text-sm mb-3">
                {Array.isArray(strat.strategy) ? (
                  <div className="space-y-1">
                    {strat.strategy.map((step: Strategy, idx: number) => (
                      <div key={idx} className="text-[var(--tg-theme-hint-color)]">
                        {step.percent * 100}% at {step.target}x
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[var(--tg-theme-hint-color)]">Invalid strategy format</div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingStrategy(strat);
                    setStrategyName(strat.name);
                    setStrategy(Array.isArray(strat.strategy) ? strat.strategy : JSON.parse(strat.strategy));
                    setView('edit');
                  }}
                  className="flex-1 p-2 border border-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-color)] rounded text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteStrategy(strat.id)}
                  className="flex-1 p-2 border border-red-500 text-red-500 rounded text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

