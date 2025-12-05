'use client';

/**
 * Live Trade Strategies Configuration Component
 * ============================================
 * Allows users to enable/disable individual entry strategies
 * for the live trade alert service.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';
import { toastSuccess, toastError } from '@/lib/utils/toast';
import { useLiveTradeStrategies, useUpdateLiveTradeStrategy, useUpdateLiveTradeStrategies } from '@/lib/hooks/use-live-trade-strategies';
import type { LiveTradeStrategy } from '@/lib/types/live-trade';

export function LiveTradeStrategies() {
  const [localStrategies, setLocalStrategies] = useState<LiveTradeStrategy[]>([]);

  // Fetch strategies
  const { data, isLoading, error } = useLiveTradeStrategies();

  // Update local state when data loads
  useEffect(() => {
    if (data?.strategies) {
      setLocalStrategies(data.strategies);
    }
  }, [data]);

  // Update single strategy
  const updateStrategyMutation = useUpdateLiveTradeStrategy();

  // Update all strategies
  const updateAllMutation = useUpdateLiveTradeStrategies();

  const handleToggle = (strategyId: string, enabled: boolean) => {
    // Update local state immediately for responsive UI
    setLocalStrategies((prev) =>
      prev.map((s) => (s.id === strategyId ? { ...s, enabled } : s))
    );

    // Update on server
    updateStrategyMutation.mutate(
      { strategyId, enabled },
      {
        onSuccess: () => {
          toastSuccess('Strategy updated successfully');
        },
        onError: (error: Error) => {
          toastError('Failed to update strategy: ' + error.message);
          // Revert local state on error
          setLocalStrategies((prev) =>
            prev.map((s) => (s.id === strategyId ? { ...s, enabled: !enabled } : s))
          );
        },
      }
    );
  };

  const handleSaveAll = () => {
    updateAllMutation.mutate(localStrategies, {
      onSuccess: () => {
        toastSuccess('Strategies updated successfully');
      },
      onError: (error: Error) => {
        toastError('Failed to update strategies: ' + error.message);
      },
    });
  };

  const handleEnableAll = () => {
    const updated = localStrategies.map((s) => ({ ...s, enabled: true }));
    setLocalStrategies(updated);
    updateAllMutation.mutate(updated, {
      onSuccess: () => {
        toastSuccess('All strategies enabled');
      },
      onError: (error: Error) => {
        toastError('Failed to enable strategies: ' + error.message);
      },
    });
  };

  const handleDisableAll = () => {
    const updated = localStrategies.map((s) => ({ ...s, enabled: false }));
    setLocalStrategies(updated);
    updateAllMutation.mutate(updated, {
      onSuccess: () => {
        toastSuccess('All strategies disabled');
      },
      onError: (error: Error) => {
        toastError('Failed to disable strategies: ' + error.message);
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Trade Entry Strategies</CardTitle>
          <CardDescription>Configure which entry strategies are active</CardDescription>
        </CardHeader>
        <CardContent>
          <LoadingSpinner />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Trade Entry Strategies</CardTitle>
          <CardDescription>Configure which entry strategies are active</CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorDisplay 
            message={error instanceof Error ? error.message : 'Failed to load strategies'} 
            onRetry={() => window.location.reload()} 
          />
        </CardContent>
      </Card>
    );
  }

  const entryStrategies = localStrategies.filter((s) => s.category === 'entry');
  const indicatorStrategies = localStrategies.filter((s) => s.category === 'indicator');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Trade Entry Strategies</CardTitle>
        <CardDescription>
          Enable or disable individual entry strategies. Only enabled strategies will trigger entry
          alerts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bulk Actions */}
        <div className="flex gap-2 pb-4 border-b">
          <Button onClick={handleEnableAll} variant="outline" size="sm">
            Enable All
          </Button>
          <Button onClick={handleDisableAll} variant="outline" size="sm">
            Disable All
          </Button>
          <Button onClick={handleSaveAll} size="sm" disabled={updateAllMutation.isPending}>
            {updateAllMutation.isPending ? 'Saving...' : 'Save All'}
          </Button>
        </div>

        {/* Entry Strategies */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Entry Strategies</h3>
          <div className="space-y-4">
            {entryStrategies.map((strategy) => (
              <div
                key={strategy.id}
                className="flex items-center justify-between p-4 rounded-lg border border-slate-700 bg-slate-800/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Label htmlFor={strategy.id} className="text-white font-medium cursor-pointer">
                      {strategy.name}
                    </Label>
                    {strategy.enabled && (
                      <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">{strategy.description}</p>
                </div>
                <Switch
                  id={strategy.id}
                  checked={strategy.enabled}
                  onCheckedChange={(checked) => handleToggle(strategy.id, checked)}
                  disabled={updateStrategyMutation.isPending}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Indicator Strategies */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Indicator-Based Strategies</h3>
          <div className="space-y-4">
            {indicatorStrategies.map((strategy) => (
              <div
                key={strategy.id}
                className="flex items-center justify-between p-4 rounded-lg border border-slate-700 bg-slate-800/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Label htmlFor={strategy.id} className="text-white font-medium cursor-pointer">
                      {strategy.name}
                    </Label>
                    {strategy.enabled && (
                      <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">{strategy.description}</p>
                </div>
                <Switch
                  id={strategy.id}
                  checked={strategy.enabled}
                  onCheckedChange={(checked) => handleToggle(strategy.id, checked)}
                  disabled={updateStrategyMutation.isPending}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-blue-300">
            <strong>Note:</strong> Changes take effect immediately for new tokens being monitored.
            Existing monitors will continue using their current configuration until they are
            restarted.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

