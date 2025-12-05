'use client';

/**
 * Strategy Configuration Panel - New Design
 * =========================================
 * Enhanced strategy configuration interface with improved visual hierarchy
 * and better organization of strategy settings.
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
import { 
  Settings, 
  Play, 
  Pause, 
  Save, 
  Zap, 
  TrendingUp, 
  BarChart3,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface StrategyCardProps {
  strategy: LiveTradeStrategy;
  onToggle: (id: string, enabled: boolean) => void;
  isUpdating: boolean;
}

function StrategyCard({ strategy, onToggle, isUpdating }: StrategyCardProps) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border transition-all duration-250 ${
        strategy.enabled
          ? 'border-emerald-500/50 bg-emerald-500/5'
          : 'border-slate-700 bg-slate-800/50'
      } hover:border-slate-600`}
    >
      {/* Active indicator bar */}
      {strategy.enabled && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <div
                className={`p-2 rounded-lg ${
                  strategy.enabled ? 'bg-emerald-500/20' : 'bg-slate-700'
                }`}
              >
                {strategy.category === 'entry' ? (
                  <TrendingUp className={`h-4 w-4 ${strategy.enabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                ) : (
                  <BarChart3 className={`h-4 w-4 ${strategy.enabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={strategy.id}
                    className="text-base font-semibold text-white cursor-pointer hover:text-slate-200 transition-colors"
                  >
                    {strategy.name}
                  </Label>
                  {strategy.enabled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Active
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-slate-400 leading-relaxed mb-3">{strategy.description}</p>

            {/* Metadata */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="capitalize">{strategy.category}</span>
              {strategy.enabled && (
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Monitoring
                </span>
              )}
            </div>
          </div>

          {/* Toggle Switch */}
          <div className="flex-shrink-0">
            <Switch
              id={strategy.id}
              checked={strategy.enabled}
              onCheckedChange={(checked) => onToggle(strategy.id, checked)}
              disabled={isUpdating}
              className="data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function StrategyConfigNew() {
  const [localStrategies, setLocalStrategies] = useState<LiveTradeStrategy[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading, error } = useLiveTradeStrategies();
  const updateStrategyMutation = useUpdateLiveTradeStrategy();
  const updateAllMutation = useUpdateLiveTradeStrategies();

  useEffect(() => {
    if (data?.strategies) {
      setLocalStrategies(data.strategies);
      setHasChanges(false);
    }
  }, [data]);

  const handleToggle = (strategyId: string, enabled: boolean) => {
    setLocalStrategies((prev) => {
      const updated = prev.map((s) => (s.id === strategyId ? { ...s, enabled } : s));
      setHasChanges(true);
      return updated;
    });

    updateStrategyMutation.mutate(
      { strategyId, enabled },
      {
        onSuccess: () => {
          toastSuccess('Strategy updated successfully');
          setHasChanges(false);
        },
        onError: (error: Error) => {
          toastError('Failed to update strategy: ' + error.message);
          setLocalStrategies((prev) =>
            prev.map((s) => (s.id === strategyId ? { ...s, enabled: !enabled } : s))
          );
          setHasChanges(false);
        },
      }
    );
  };

  const handleSaveAll = () => {
    updateAllMutation.mutate(localStrategies, {
      onSuccess: () => {
        toastSuccess('All strategies saved successfully');
        setHasChanges(false);
      },
      onError: (error: Error) => {
        toastError('Failed to save strategies: ' + error.message);
      },
    });
  };

  const handleEnableAll = () => {
    const updated = localStrategies.map((s) => ({ ...s, enabled: true }));
    setLocalStrategies(updated);
    setHasChanges(true);
    updateAllMutation.mutate(updated, {
      onSuccess: () => {
        toastSuccess('All strategies enabled');
        setHasChanges(false);
      },
      onError: (error: Error) => {
        toastError('Failed to enable strategies: ' + error.message);
        setHasChanges(false);
      },
    });
  };

  const handleDisableAll = () => {
    const updated = localStrategies.map((s) => ({ ...s, enabled: false }));
    setLocalStrategies(updated);
    setHasChanges(true);
    updateAllMutation.mutate(updated, {
      onSuccess: () => {
        toastSuccess('All strategies disabled');
        setHasChanges(false);
      },
      onError: (error: Error) => {
        toastError('Failed to disable strategies: ' + error.message);
        setHasChanges(false);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner text="Loading strategies..." />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        message={error instanceof Error ? error.message : 'Failed to load strategies'}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const entryStrategies = localStrategies.filter((s) => s.category === 'entry');
  const indicatorStrategies = localStrategies.filter((s) => s.category === 'indicator');
  const enabledCount = localStrategies.filter((s) => s.enabled).length;
  const totalCount = localStrategies.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Strategy Configuration</h1>
          <p className="text-slate-400">Manage entry and indicator strategies for live trading</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Active Strategies</div>
            <div className="text-lg font-bold text-white">
              {enabledCount} / {totalCount}
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-slate-400" />
              <span className="text-sm text-slate-400">Bulk Actions</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleEnableAll}
                variant="outline"
                size="sm"
                className="border-slate-600 hover:bg-slate-700"
              >
                <Play className="h-4 w-4 mr-2" />
                Enable All
              </Button>
              <Button
                onClick={handleDisableAll}
                variant="outline"
                size="sm"
                className="border-slate-600 hover:bg-slate-700"
              >
                <Pause className="h-4 w-4 mr-2" />
                Disable All
              </Button>
              <Button
                onClick={handleSaveAll}
                size="sm"
                disabled={updateAllMutation.isPending || !hasChanges}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateAllMutation.isPending ? 'Saving...' : 'Save All'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entry Strategies */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-xl font-semibold text-white">Entry Strategies</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-slate-700 text-slate-300 rounded-full">
            {entryStrategies.filter((s) => s.enabled).length} active
          </span>
        </div>
        <div className="grid gap-4">
          {entryStrategies.map((strategy) => (
            <StrategyCard
              key={strategy.id}
              strategy={strategy}
              onToggle={handleToggle}
              isUpdating={updateStrategyMutation.isPending}
            />
          ))}
        </div>
      </div>

      {/* Indicator Strategies */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-400" />
          <h2 className="text-xl font-semibold text-white">Indicator-Based Strategies</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-slate-700 text-slate-300 rounded-full">
            {indicatorStrategies.filter((s) => s.enabled).length} active
          </span>
        </div>
        <div className="grid gap-4">
          {indicatorStrategies.map((strategy) => (
            <StrategyCard
              key={strategy.id}
              strategy={strategy}
              onToggle={handleToggle}
              isUpdating={updateStrategyMutation.isPending}
            />
          ))}
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-blue-300 mb-1">Configuration Note</div>
            <p className="text-sm text-blue-200/80 leading-relaxed">
              Changes take effect immediately for new tokens being monitored. Existing monitors
              will continue using their current configuration until they are restarted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

