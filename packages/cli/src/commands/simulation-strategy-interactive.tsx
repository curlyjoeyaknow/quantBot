/**
 * Interactive Strategy Creation using Ink
 * =======================================
 * Provides beautiful, React-based interactive prompts for creating strategies.
 */

import React, { useState, useEffect } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { StrategiesRepository } from '@quantbot/storage';
import { ensureInitialized } from '../core/initialization-manager.js';

/**
 * Step-by-step state values for interactive workflow.
 */
type Step =
  | 'loading'
  | 'name'
  | 'version'
  | 'category'
  | 'description'
  | 'entry-type'
  | 'entry-drop-percent'
  | 'entry-trailing-percent'
  | 'entry-max-wait'
  | 'stop-loss-percent'
  | 'stop-loss-trailing'
  | 'profit-targets'
  | 'reentry-enable'
  | 'reentry-config'
  | 'indicators-entry'
  | 'indicators-stop-loss'
  | 'indicators-trailing-stop'
  | 'indicators-profit-target'
  | 'summary'
  | 'saving'
  | 'success'
  | 'error';

/**
 * Application state for strategy creation.
 */
interface AppState {
  step: Step;
  duckdbPath?: string;
  name?: string;
  version?: string;
  category?: string;
  description?: string;
  entryType?: 'immediate' | 'drop' | 'trailing';
  entryDropPercent?: number;
  entryTrailingPercent?: number;
  entryMaxWait?: number;
  stopLossPercent?: number;
  stopLossTrailing?: number | 'none';
  profitTargets?: Array<{ target: number; percent: number }>;
  reentryEnabled?: boolean;
  reentryPercent?: number;
  reentryMaxCount?: number;
  reentrySizePercent?: number;
  useIndicatorEntry?: boolean;
  useIndicatorStopLoss?: boolean;
  useIndicatorTrailingStop?: boolean;
  useIndicatorProfitTarget?: boolean;
  entryConfig?: Record<string, unknown>;
  reentryConfig?: Record<string, unknown>;
  costConfig?: Record<string, unknown>;
  strategyId?: string;
  error?: string;
}

/**
 * UI Component: Loading indicator.
 */
function LoadingScreen() {
  const [dots, setDots] = useState('');
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">📊 Initializing strategy creation{dots}</Text>
    </Box>
  );
}

/**
 * UI Component: Name input.
 */
function NameInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const handleSubmit = () => {
    if (value.trim().length > 0) {
      onComplete();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>📝 Strategy Name:</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={onChange} onSubmit={handleSubmit} placeholder="e.g., PT2_SL25" />
      </Box>
      <Text dimColor>Press Enter to continue</Text>
    </Box>
  );
}

/**
 * UI Component: Version input.
 */
function VersionInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const handleSubmit = () => {
    onComplete();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>📝 Version (default: 1):</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={onChange} onSubmit={handleSubmit} placeholder="1" />
      </Box>
      <Text dimColor>Press Enter to continue (or leave empty for default)</Text>
    </Box>
  );
}

/**
 * UI Component: Category input.
 */
function CategoryInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const handleSubmit = () => {
    onComplete();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>📝 Category (optional):</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={onChange} onSubmit={handleSubmit} placeholder="e.g., conservative, aggressive" />
      </Box>
      <Text dimColor>Press Enter to continue (or leave empty to skip)</Text>
    </Box>
  );
}

/**
 * UI Component: Description input.
 */
function DescriptionInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const handleSubmit = () => {
    onComplete();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>📝 Description (optional):</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={onChange} onSubmit={handleSubmit} placeholder="Strategy description" />
      </Box>
      <Text dimColor>Press Enter to continue (or leave empty to skip)</Text>
    </Box>
  );
}

/**
 * UI Component: Entry type selection.
 */
function EntryTypeSelection({ onSelect }: { onSelect: (type: 'immediate' | 'drop' | 'trailing') => void }) {
  const options = [
    { label: '1. Immediate - Enter immediately at alert price', value: 'immediate' },
    { label: '2. Drop - Wait for price to drop before entering', value: 'drop' },
    { label: '3. Trailing - Use trailing stop entry', value: 'trailing' },
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>🎯 Entry Type Selection:</Text>
      <Box marginTop={1}>
        <Text dimColor>Use arrow keys to navigate, Enter to select</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={options}
          onSelect={(item) => onSelect(item.value as 'immediate' | 'drop' | 'trailing')}
        />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Number input with validation.
 */
function NumberInput({
  label,
  value,
  onChange,
  onComplete,
  placeholder,
  helpText,
  min,
  max,
  allowNegative = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onComplete: () => void;
  placeholder?: string;
  helpText?: string;
  min?: number;
  max?: number;
  allowNegative?: boolean;
}) {
  const handleSubmit = () => {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return;
    }
    if (min !== undefined && num < min) {
      return;
    }
    if (max !== undefined && num > max) {
      return;
    }
    if (!allowNegative && num < 0) {
      return;
    }
    onComplete();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>{label}</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={onChange} onSubmit={handleSubmit} placeholder={placeholder} />
      </Box>
      {helpText && (
        <Box marginTop={1}>
          <Text dimColor>{helpText}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue</Text>
      </Box>
    </Box>
  );
}

/**
 * UI Component: Yes/No selection.
 */
function YesNoSelection({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (yes: boolean) => void;
}) {
  const options = [
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>{label}</Text>
      <Box marginTop={1}>
        <SelectInput
          items={options}
          onSelect={(item) => onSelect(item.value === 'yes')}
        />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Profit targets input (simplified - single target for now).
 */
function ProfitTargetsInput({
  onComplete,
}: {
  onComplete: (targets: Array<{ target: number; percent: number }>) => void;
}) {
  const [targetValue, setTargetValue] = useState('');
  const [percentValue, setPercentValue] = useState('100');
  const [step, setStep] = useState<'target' | 'percent'>('target');

  const handleTargetSubmit = () => {
    const target = parseFloat(targetValue);
    if (isNaN(target) || target <= 0) {
      return;
    }
    setStep('percent');
  };

  const handlePercentSubmit = () => {
    const percent = parseFloat(percentValue);
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      return;
    }
    const target = parseFloat(targetValue);
    onComplete([{ target, percent: percent / 100 }]);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>💰 Profit Target:</Text>
      <Box marginTop={1} flexDirection="column">
        {step === 'target' ? (
          <>
            <Text>Target multiplier (e.g., 2.0 for 2x):</Text>
            <Box marginTop={1}>
              <TextInput value={targetValue} onChange={setTargetValue} onSubmit={handleTargetSubmit} placeholder="2.0" />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </>
        ) : (
          <>
            <Text>Percent of position to exit (0-100):</Text>
            <Box marginTop={1}>
              <TextInput value={percentValue} onChange={setPercentValue} onSubmit={handlePercentSubmit} placeholder="100" />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

/**
 * UI Component: Re-entry configuration.
 */
function ReentryConfigInput({
  onComplete,
}: {
  onComplete: (config: { trailingReEntry: number; maxReEntries: number; sizePercent: number }) => void;
}) {
  const [percentValue, setPercentValue] = useState('');
  const [maxCountValue, setMaxCountValue] = useState('1');
  const [sizePercentValue, setSizePercentValue] = useState('50');
  const [step, setStep] = useState<'percent' | 'maxCount' | 'size'>('percent');

  const handlePercentSubmit = () => {
    const percent = parseFloat(percentValue);
    if (isNaN(percent) || percent < 0 || percent > 99) {
      return;
    }
    setStep('maxCount');
  };

  const handleMaxCountSubmit = () => {
    const maxCount = parseInt(maxCountValue, 10);
    if (isNaN(maxCount) || maxCount < 0 || maxCount > 10) {
      return;
    }
    setStep('size');
  };

  const handleSizeSubmit = () => {
    const sizePercent = parseFloat(sizePercentValue);
    if (isNaN(sizePercent) || sizePercent < 0 || sizePercent > 100) {
      return;
    }
    const percent = parseFloat(percentValue);
    const maxCount = parseInt(maxCountValue, 10);
    onComplete({
      trailingReEntry: percent / 100,
      maxReEntries: maxCount,
      sizePercent: sizePercent / 100,
    });
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>🔄 Re-entry Configuration:</Text>
      <Box marginTop={1} flexDirection="column">
        {step === 'percent' ? (
          <>
            <Text>Percent retrace from peak to trigger re-entry (0-99):</Text>
            <Box marginTop={1}>
              <TextInput value={percentValue} onChange={setPercentValue} onSubmit={handlePercentSubmit} placeholder="50" />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </>
        ) : step === 'maxCount' ? (
          <>
            <Text>Maximum number of re-entries (0-10):</Text>
            <Box marginTop={1}>
              <TextInput value={maxCountValue} onChange={setMaxCountValue} onSubmit={handleMaxCountSubmit} placeholder="1" />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </>
        ) : (
          <>
            <Text>Re-entry size as percent of original (0-100):</Text>
            <Box marginTop={1}>
              <TextInput value={sizePercentValue} onChange={setSizePercentValue} onSubmit={handleSizeSubmit} placeholder="50" />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

/**
 * UI Component: Summary screen.
 */
function SummaryScreen({
  state,
  onConfirm,
  onCancel,
}: {
  state: AppState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📋 Strategy Summary
      </Text>
      <Text>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Name: <Text color="green">{state.name}</Text></Text>
        <Text>Version: <Text color="green">{state.version || '1'}</Text></Text>
        {state.category && <Text>Category: <Text color="green">{state.category}</Text></Text>}
        {state.description && <Text>Description: <Text color="green">{state.description}</Text></Text>}
        <Text>Entry Type: <Text color="green">{state.entryType}</Text></Text>
        {state.entryType === 'drop' && state.entryDropPercent !== undefined && (
          <Text>Entry Drop: <Text color="green">{state.entryDropPercent}%</Text></Text>
        )}
        {state.entryType === 'trailing' && state.entryTrailingPercent !== undefined && (
          <Text>Entry Trailing: <Text color="green">{state.entryTrailingPercent}%</Text></Text>
        )}
        {state.entryMaxWait !== undefined && (
          <Text>Max Wait Time: <Text color="green">{state.entryMaxWait} minutes</Text></Text>
        )}
        {state.stopLossPercent !== undefined && (
          <Text>Stop Loss: <Text color="green">-{state.stopLossPercent}%</Text></Text>
        )}
        {state.stopLossTrailing !== undefined && state.stopLossTrailing !== 'none' && (
          <Text>Trailing Stop: <Text color="green">Enabled</Text></Text>
        )}
        {state.profitTargets && state.profitTargets.length > 0 && (
          <Text>
            Profit Target: <Text color="green">{state.profitTargets[0].target}x ({state.profitTargets[0].percent * 100}%)</Text>
          </Text>
        )}
        {state.reentryEnabled && (
          <>
            <Text>Re-entry: <Text color="green">Enabled</Text></Text>
            {state.reentryPercent !== undefined && (
              <Text>  - Retrace: <Text color="green">{state.reentryPercent * 100}%</Text></Text>
            )}
            {state.reentryMaxCount !== undefined && (
              <Text>  - Max Count: <Text color="green">{state.reentryMaxCount}</Text></Text>
            )}
            {state.reentrySizePercent !== undefined && (
              <Text>  - Size: <Text color="green">{state.reentrySizePercent * 100}%</Text></Text>
            )}
          </>
        )}
        {(state.useIndicatorEntry || state.useIndicatorStopLoss || state.useIndicatorTrailingStop || state.useIndicatorProfitTarget) && (
          <Text>Indicators: <Text color="green">
            {[
              state.useIndicatorEntry && 'Entry',
              state.useIndicatorStopLoss && 'Stop Loss',
              state.useIndicatorTrailingStop && 'Trailing Stop',
              state.useIndicatorProfitTarget && 'Profit Target',
            ].filter(Boolean).join(', ')}
          </Text></Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow" bold>Create this strategy? (y/n)</Text>
        <Text dimColor>Press 'y' to confirm, 'n' or Escape to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * UI Component: Success screen.
 */
function SuccessScreen({ strategyId }: { strategyId: string }) {
  const { exit } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => {
      exit();
    }, 3000);

    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>
        ✅ Strategy created successfully!
      </Text>
      <Text>Strategy ID: {strategyId}</Text>
      <Text color="gray">Exiting in 3 seconds...</Text>
    </Box>
  );
}

/**
 * UI Component: Error screen.
 */
function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  useInput((input, key) => {
    if (key.return) {
      onRetry();
    } else if (key.escape) {
      process.exit(1);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="red" bold>
        ❌ Error
      </Text>
      <Text>{error}</Text>
      <Text color="gray">Press Enter to retry, Escape to exit</Text>
    </Box>
  );
}

/**
 * Main interactive strategy creation app component.
 */
function InteractiveStrategyCreationApp({ duckdbPath }: { duckdbPath?: string }) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    step: 'loading',
    duckdbPath: duckdbPath || process.env.DUCKDB_PATH || 'data/quantbot.db',
  });

  // Global escape handler
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      try {
        await ensureInitialized();
        setState((s) => ({ ...s, step: 'name' }));
      } catch (error) {
        setState((s) => ({
          ...s,
          step: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    };
    init();
  }, []);

  const handleNameComplete = () => {
    if (state.name && state.name.trim().length > 0) {
      setState((s) => ({ ...s, step: 'version' }));
    }
  };

  const handleVersionComplete = () => {
    setState((s) => ({ ...s, step: 'category', version: s.version || '1' }));
  };

  const handleCategoryComplete = () => {
    setState((s) => ({ ...s, step: 'description' }));
  };

  const handleDescriptionComplete = () => {
    setState((s) => ({ ...s, step: 'entry-type' }));
  };

  const handleEntryTypeSelect = (type: 'immediate' | 'drop' | 'trailing') => {
    if (type === 'drop') {
      setState((s) => ({ ...s, entryType: type, step: 'entry-drop-percent' }));
    } else if (type === 'trailing') {
      setState((s) => ({ ...s, entryType: type, step: 'entry-trailing-percent' }));
    } else {
      setState((s) => ({ ...s, entryType: type, step: 'stop-loss-percent' }));
    }
  };


  const handleProfitTargetsComplete = (targets: Array<{ target: number; percent: number }>) => {
    setState((s) => ({ ...s, profitTargets: targets, step: 'reentry-enable' }));
  };

  const handleReentryConfigComplete = (config: { trailingReEntry: number; maxReEntries: number; sizePercent: number }) => {
    setState((s) => ({
      ...s,
      reentryPercent: config.trailingReEntry,
      reentryMaxCount: config.maxReEntries,
      reentrySizePercent: config.sizePercent,
      step: 'indicators-entry',
    }));
  };

  const handleReentryEnableSelect = (enabled: boolean) => {
    if (enabled) {
      setState((s) => ({ ...s, reentryEnabled: true, step: 'reentry-config' }));
    } else {
      setState((s) => ({ ...s, reentryEnabled: false, step: 'indicators-entry' }));
    }
  };

  const handleIndicatorEntrySelect = (use: boolean) => {
    setState((s) => ({ ...s, useIndicatorEntry: use, step: 'indicators-stop-loss' }));
  };

  const handleIndicatorStopLossSelect = (use: boolean) => {
    setState((s) => ({ ...s, useIndicatorStopLoss: use, step: 'indicators-trailing-stop' }));
  };

  const handleIndicatorTrailingStopSelect = (use: boolean) => {
    setState((s) => ({ ...s, useIndicatorTrailingStop: use, step: 'indicators-profit-target' }));
  };

  const handleIndicatorProfitTargetSelect = (use: boolean) => {
    setState((s) => ({ ...s, useIndicatorProfitTarget: use, step: 'summary' }));
  };

  const handleSummaryConfirm = async () => {
    setState((s) => ({ ...s, step: 'saving' }));

    try {
      const dbPath = state.duckdbPath || process.env.DUCKDB_PATH || 'data/quantbot.db';
      const repo = new StrategiesRepository(dbPath);

      const strategyId = `${state.name}_${state.version || '1'}`.replace(/[^a-zA-Z0-9_]/g, '_');

      // Build entry config
      const entryConfig: Record<string, unknown> = {};
      if (state.entryType === 'drop' && state.entryDropPercent !== undefined) {
        entryConfig.initialEntry = -Math.abs(state.entryDropPercent) / 100;
        if (state.entryMaxWait !== undefined) {
          entryConfig.maxWaitTime = state.entryMaxWait;
        }
      } else if (state.entryType === 'trailing' && state.entryTrailingPercent !== undefined) {
        entryConfig.trailingEntry = state.entryTrailingPercent / 100;
        if (state.entryMaxWait !== undefined) {
          entryConfig.maxWaitTime = state.entryMaxWait;
        }
      } else {
        entryConfig.initialEntry = 'none';
      }

      // Build stop loss config
      const stopLossConfig: Record<string, unknown> = {};
      if (state.stopLossPercent !== undefined) {
        stopLossConfig.initial = -Math.abs(state.stopLossPercent) / 100;
        if (state.stopLossTrailing !== undefined && state.stopLossTrailing !== 'none') {
          stopLossConfig.trailing = state.stopLossTrailing;
        }
      }

      // Build re-entry config
      const reentryConfig: Record<string, unknown> | undefined =
        state.reentryEnabled && state.reentryPercent !== undefined
          ? {
              trailingReEntry: state.reentryPercent,
              maxReEntries: state.reentryMaxCount || 1,
              sizePercent: state.reentrySizePercent || 0.5,
            }
          : undefined;

      const config: Record<string, unknown> = {
        name: state.name!,
        profitTargets: state.profitTargets || [{ target: 2.0, percent: 1.0 }],
        entry: entryConfig,
        stopLoss: stopLossConfig,
      };

      if (reentryConfig) {
        config.reEntry = reentryConfig;
      }

      // Note: Indicator configuration would go here when implemented
      // if (state.useIndicatorEntry) { config.entrySignal = ... }
      // if (state.useIndicatorStopLoss) { ... }
      // etc.

      await repo.create({
        name: state.name!,
        version: state.version || '1',
        category: state.category || undefined,
        description: state.description || undefined,
        config,
        isActive: true,
      });

      setState((s) => ({ ...s, step: 'success', strategyId }));
    } catch (error) {
      setState((s) => ({
        ...s,
        step: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const handleSummaryCancel = () => {
    exit();
  };

  const handleErrorRetry = () => {
    setState((s) => ({ ...s, step: 'name', error: undefined }));
  };

  // Main step rendering
  switch (state.step) {
    case 'loading':
      return <LoadingScreen />;
    case 'name':
      return (
        <NameInput
          value={state.name || ''}
          onChange={(v) => setState((s) => ({ ...s, name: v }))}
          onComplete={handleNameComplete}
        />
      );
    case 'version':
      return (
        <VersionInput
          value={state.version || ''}
          onChange={(v) => setState((s) => ({ ...s, version: v }))}
          onComplete={handleVersionComplete}
        />
      );
    case 'category':
      return (
        <CategoryInput
          value={state.category || ''}
          onChange={(v) => setState((s) => ({ ...s, category: v }))}
          onComplete={handleCategoryComplete}
        />
      );
    case 'description':
      return (
        <DescriptionInput
          value={state.description || ''}
          onChange={(v) => setState((s) => ({ ...s, description: v }))}
          onComplete={handleDescriptionComplete}
        />
      );
    case 'entry-type':
      return <EntryTypeSelection onSelect={handleEntryTypeSelect} />;
    case 'entry-drop-percent':
      return (
        <NumberInput
          label="📉 Entry Drop Percentage:"
          value={state.entryDropPercent?.toString() || ''}
          onChange={(v) => {
            const num = v === '' ? undefined : parseFloat(v);
            setState((s) => ({ ...s, entryDropPercent: isNaN(num || NaN) ? undefined : num }));
          }}
          onComplete={() => {
            const num = parseFloat(state.entryDropPercent?.toString() || '');
            if (!isNaN(num) && num >= 0 && num <= 99) {
              setState((s) => ({ ...s, entryDropPercent: num, step: 'entry-max-wait' }));
            }
          }}
          placeholder="30 (for 30% drop)"
          helpText="Enter the percentage drop to wait for before entering (e.g., 30 for 30%)"
          min={0}
          max={99}
        />
      );
    case 'entry-max-wait':
      return (
        <NumberInput
          label="⏱️ Maximum Wait Time (minutes):"
          value={state.entryMaxWait?.toString() || ''}
          onChange={(v) => {
            const num = v === '' ? undefined : parseInt(v, 10);
            setState((s) => ({ ...s, entryMaxWait: isNaN(num || NaN) ? undefined : num }));
          }}
          onComplete={() => {
            const num = parseInt(state.entryMaxWait?.toString() || '', 10);
            if (!isNaN(num) && num >= 1) {
              setState((s) => ({ ...s, entryMaxWait: num, step: 'stop-loss-percent' }));
            }
          }}
          placeholder="60"
          helpText="Maximum time to wait for entry conditions (in minutes)"
          min={1}
        />
      );
    case 'entry-trailing-percent':
      return (
        <NumberInput
          label="📈 Entry Trailing Rebound Percentage:"
          value={state.entryTrailingPercent?.toString() || ''}
          onChange={(v) => {
            const num = v === '' ? undefined : parseFloat(v);
            setState((s) => ({ ...s, entryTrailingPercent: isNaN(num || NaN) ? undefined : num }));
          }}
          onComplete={() => {
            const num = parseFloat(state.entryTrailingPercent?.toString() || '');
            if (!isNaN(num) && num >= 0 && num <= 99) {
              setState((s) => ({ ...s, entryTrailingPercent: num, step: 'stop-loss-percent' }));
            }
          }}
          placeholder="10 (for 10% rebound)"
          helpText="Enter the percentage rebound from low to trigger entry (e.g., 10 for 10%)"
          min={0}
          max={99}
        />
      );
    case 'stop-loss-percent':
      return (
        <NumberInput
          label="🛑 Stop Loss Percentage:"
          value={state.stopLossPercent?.toString() || ''}
          onChange={(v) => {
            const num = v === '' ? undefined : parseFloat(v);
            setState((s) => ({ ...s, stopLossPercent: isNaN(num || NaN) ? undefined : num }));
          }}
          onComplete={() => {
            const num = parseFloat(state.stopLossPercent?.toString() || '');
            if (!isNaN(num) && num >= 0 && num <= 99) {
              setState((s) => ({ ...s, stopLossPercent: num, step: 'stop-loss-trailing' }));
            }
          }}
          placeholder="25 (for -25% stop loss)"
          helpText="Enter the stop loss percentage (e.g., 25 for -25% stop loss)"
          min={0}
          max={99}
        />
      );
    case 'stop-loss-trailing':
      return (
        <YesNoSelection
          label="🔄 Use Trailing Stop Loss? (Yes/No)"
          onSelect={(yes) => {
            setState((s) => ({
              ...s,
              stopLossTrailing: yes ? 0.5 : 'none',
              step: 'profit-targets',
            }));
          }}
        />
      );
    case 'profit-targets':
      return <ProfitTargetsInput onComplete={handleProfitTargetsComplete} />;
    case 'reentry-enable':
      return <YesNoSelection label="🔄 Enable Re-entry? (Yes/No)" onSelect={handleReentryEnableSelect} />;
    case 'reentry-config':
      return <ReentryConfigInput onComplete={handleReentryConfigComplete} />;
    case 'indicators-entry':
      return <YesNoSelection label="📊 Use Indicator for Entry? (Yes/No)" onSelect={handleIndicatorEntrySelect} />;
    case 'indicators-stop-loss':
      return <YesNoSelection label="📊 Use Indicator for Stop Loss? (Yes/No)" onSelect={handleIndicatorStopLossSelect} />;
    case 'indicators-trailing-stop':
      return <YesNoSelection label="📊 Use Indicator for Trailing Stop? (Yes/No)" onSelect={handleIndicatorTrailingStopSelect} />;
    case 'indicators-profit-target':
      return <YesNoSelection label="📊 Use Indicator for Profit Target? (Yes/No)" onSelect={handleIndicatorProfitTargetSelect} />;
    case 'summary':
      return <SummaryScreen state={state} onConfirm={handleSummaryConfirm} onCancel={handleSummaryCancel} />;
    case 'saving':
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="cyan" bold>💾 Saving strategy...</Text>
          <Text dimColor>Please wait...</Text>
        </Box>
      );
    case 'success':
      return <SuccessScreen strategyId={state.strategyId!} />;
    case 'error':
      return <ErrorScreen error={state.error!} onRetry={handleErrorRetry} />;
    default:
      return <Text>Unknown step</Text>;
  }
}

/**
 * Entrypoint: Run the interactive strategy creation workflow.
 */
export async function runInteractiveStrategyCreation(duckdbPath?: string): Promise<void> {
  render(<InteractiveStrategyCreationApp duckdbPath={duckdbPath} />);
}

/**
 * Registers the interactive strategy creation command.
 * Note: This is registered directly in simulation.ts as part of the simulation command group.
 */
export function registerInteractiveStrategyCreationCommand(): void {
  // This function is kept for consistency but the command is registered in simulation.ts
  // The actual registration happens in registerSimulationCommands()
}

