/**
 * Interactive Simulation Commands using Ink
 * ==========================================
 * Provides beautiful, React-based interactive prompts for running simulations.
 *
 * This module is the main entry point for the guided simulation CLI workflow.
 *
 * Maintainer Notes:
 * - Uses Ink (React for CLI) for UI.
 * - Connects to Quantbot storage repositories for strategies and callers.
 * - The workflow is stateful through AppState and advances based on user interactions.
 * - See `runInteractiveSimulation` and `registerInteractiveSimulationCommand` at bottom for CLI integration.
 */

import React, { useState, useEffect } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import type { Command } from 'commander';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import { StrategiesRepository, CallersRepository } from '@quantbot/storage';
import { ensureInitialized } from '../core/initialization-manager.js';
import { handleError } from '../core/error-handler.js';

/**
 * Constant: List of months, for selection UIs.
 */
const MONTHS = [
  { label: 'January', value: 1 },
  { label: 'February', value: 2 },
  { label: 'March', value: 3 },
  { label: 'April', value: 4 },
  { label: 'May', value: 5 },
  { label: 'June', value: 6 },
  { label: 'July', value: 7 },
  { label: 'August', value: 8 },
  { label: 'September', value: 9 },
  { label: 'October', value: 10 },
  { label: 'November', value: 11 },
  { label: 'December', value: 12 },
];

/**
 * Step-by-step state values for interactive workflow.
 */
type Step =
  | 'loading'
  | 'strategy'
  | 'caller'
  | 'year-from'
  | 'month-from'
  | 'day-from'
  | 'year-to'
  | 'month-to'
  | 'day-to'
  | 'pre-window'
  | 'post-window'
  | 'dry-run'
  | 'summary'
  | 'running'
  | 'results'
  | 'error';

/**
 * Application state for the top-level interactive simulation.
 */
interface AppState {
  step: Step;
  strategies: Array<{ label: string; value: string }>;
  callers: Array<{ label: string; value: string | undefined }>;
  selectedStrategy?: string;
  selectedCaller?: string;
  fromYear?: number;
  fromMonth?: number;
  fromDay?: number;
  toYear?: number;
  toMonth?: number;
  toDay?: number;
  preWindow?: number;
  postWindow?: number;
  dryRun?: boolean;
  result?: unknown;
  error?: string;
}

/**
 * UI Component: Loading indicator.
 */
function LoadingScreen() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">📊 Loading strategies and callers...</Text>
    </Box>
  );
}

/**
 * UI Component: Strategy Selection Screen.
 * @param strategies List of selectable strategies
 * @param onSelect Callback when a strategy is selected
 */
function StrategySelection({
  strategies,
  onSelect,
}: {
  strategies: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}) {
  /**
   * Handle select event from SelectInput.
   */
  const handleSelect = (item: { label: string; value: string }) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        🎯 Select Strategy
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1}>
        <SelectInput items={strategies} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Caller Selection Screen.
 * @param callers List of callable entities (or all)
 * @param onSelect Callback when a caller is selected
 */
function CallerSelection({
  callers,
  onSelect,
}: {
  callers: Array<{ label: string; value: string | undefined }>;
  onSelect: (value: string | undefined) => void;
}) {
  const handleSelect = (item: { label: string; value: string | undefined }) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📞 Filter by Caller (Optional)
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1}>
        <SelectInput items={callers} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Year Selection (for both start/end date).
 * @param label Start or End date
 * @param onSelect Callback for year selection
 */
function YearSelection({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (year: number) => void;
}) {
  const currentYear = DateTime.utc().year;
  // Populate up to 5 recent years, descending
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => ({
    label: String(y),
    value: y,
  }));

  const handleSelect = (item: { label: string; value: number }) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📅 {label} - Select Year
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1}>
        <SelectInput items={years} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Month Selection (for both start/end date).
 * @param label Start or End date
 * @param onSelect Callback for month selection
 */
function MonthSelection({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (month: number) => void;
}) {
  const handleSelect = (item: { label: string; value: number }) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📅 {label} - Select Month
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1}>
        <SelectInput items={MONTHS} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Day Input prompt.
 * @param label Start or End date
 * @param maxDay Maximum day of the selected month/year
 * @param defaultDay Default value for day input
 * @param onComplete Callback when a valid day is submitted
 */
function DayInput({
  label,
  maxDay,
  defaultDay,
  onComplete,
}: {
  label: string;
  maxDay: number;
  defaultDay: number;
  onComplete: (day: number) => void;
}) {
  const [value, setValue] = useState(String(defaultDay));
  const [error, setError] = useState<string | undefined>();

  /**
   * Validate and submit entered day.
   */
  const handleSubmit = () => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > maxDay) {
      setError(`Please enter a number between 1 and ${maxDay}`);
      return;
    }
    setError(undefined);
    onComplete(num);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📅 {label} - Enter Day (1-{maxDay})
      </Text>
      {error && <Text color="red">{error}</Text>}
      <Box marginTop={1}>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
      <Text dimColor>Press Enter to confirm</Text>
    </Box>
  );
}

/**
 * UI Component: Window Time Selection prompt.
 * Used for both pre- and post-window durations.
 * @param label Window type label
 * @param options List of time length options
 * @param onSelect Callback with chosen duration
 */
function WindowSelection({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: Array<{ label: string; value: number }>;
  onSelect: (value: number) => void;
}) {
  const handleSelect = (item: { label: string; value: number }) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        ⏱️ {label}
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1}>
        <SelectInput items={options} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * UI Component: Dry Run Confirmation step.
 * Allows toggling dry run (no persistence).
 * @param onConfirm Callback with boolean for dryRun
 */
function DryRunConfirmation({ onConfirm }: { onConfirm: (dryRun: boolean) => void }) {
  const [selected, setSelected] = useState(0);
  // Prompt options, yes = dry run, no = persist
  const options = [
    { label: 'Yes (dry run - no persistence)', value: true },
    { label: 'No (persist results)', value: false },
  ];

  // Keyboard input handler for navigation/submit
  useInput((_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected((s) => Math.min(options.length - 1, s + 1));
    } else if (key.return) {
      onConfirm(options[selected]!.value);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        ✅ Dry Run Mode?
      </Text>
      <Text>Use ↑↓ to navigate, Enter to select</Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((opt, idx) => (
          <Text key={idx} color={idx === selected ? 'green' : undefined}>
            {idx === selected ? '❯ ' : '  '}
            {opt.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/**
 * UI Component: Final Summary/confirmation screen.
 * Lists out all gathered inputs and allows user to proceed or cancel.
 * @param state The AppState snapshot for summary
 * @param onConfirm Proceed callback
 * @param onCancel Cancel callback
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
  const [selected, setSelected] = useState(0);

  // Navigation input: up/down/enter for summary options
  useInput((_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected((s) => Math.min(1, s + 1));
    } else if (key.return) {
      if (selected === 0) {
        onConfirm();
      } else {
        onCancel();
      }
    }
  });

  // ISO date summaries
  const fromDate = DateTime.utc(state.fromYear!, state.fromMonth!, state.fromDay!);
  const toDate = DateTime.utc(state.toYear!, state.toMonth!, state.toDay!);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        📋 Simulation Summary
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  Strategy:     {state.selectedStrategy}</Text>
        <Text>  Caller:       {state.selectedCaller ?? '(all)'}</Text>
        <Text>  Date Range:   {fromDate.toISODate()} to {toDate.toISODate()}</Text>
        <Text>  Pre-window:   {state.preWindow} minutes</Text>
        <Text>  Post-window:  {state.postWindow} minutes</Text>
        <Text>  Dry Run:      {state.dryRun ? 'Yes' : 'No'}</Text>
      </Box>
      <Box marginTop={2} flexDirection="column">
        <Text color={selected === 0 ? 'green' : undefined}>
          {selected === 0 ? '❯ ' : '  '}
          Proceed with simulation
        </Text>
        <Text color={selected === 1 ? 'red' : undefined}>
          {selected === 1 ? '❯ ' : '  '}
          Cancel
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select
        </Text>
      </Box>
    </Box>
  );
}

/**
 * UI Component: Running progress indicator.
 */
function RunningScreen() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="yellow">⚙️  Running simulation...</Text>
      <Text dimColor>Please wait...</Text>
    </Box>
  );
}

/**
 * Simulation result type returned from workflow.
 */
interface SimulationResult {
  runId: string;
  strategyName: string;
  callerName?: string;
  fromISO: string;
  toISO: string;
  dryRun: boolean;
  totals: {
    callsFound: number;
    callsAttempted: number;
    callsSucceeded: number;
    callsFailed: number;
    tradesTotal: number;
  };
  pnl: {
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
  };
}

/**
 * UI Component: Render simulation results in summary table.
 * @param result The completed simulation result object
 */
function ResultsScreen({ result }: { result: SimulationResult }) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>
        ✅ Simulation complete!
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>📈 SUMMARY</Text>
        <Text>  Run ID:          {result.runId}</Text>
        <Text>  Strategy:        {result.strategyName}</Text>
        <Text>  Caller:          {result.callerName ?? '(all)'}</Text>
        <Text>  Date Range:      {result.fromISO} to {result.toISO}</Text>
        <Text>  Dry Run:         {result.dryRun ? 'Yes' : 'No'}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>📊 TOTALS</Text>
        <Text>  Calls Found:     {result.totals.callsFound}</Text>
        <Text>  Calls Attempted: {result.totals.callsAttempted}</Text>
        <Text>  Calls Succeeded: {result.totals.callsSucceeded}</Text>
        <Text>  Calls Failed:    {result.totals.callsFailed}</Text>
        <Text>  Total Trades:    {result.totals.tradesTotal}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>💰 PnL STATISTICS</Text>
        <Text>  Min:             {result.pnl.min?.toFixed(4) ?? 'N/A'}</Text>
        <Text>  Max:             {result.pnl.max?.toFixed(4) ?? 'N/A'}</Text>
        <Text>  Mean:            {result.pnl.mean?.toFixed(4) ?? 'N/A'}</Text>
        <Text>  Median:          {result.pnl.median?.toFixed(4) ?? 'N/A'}</Text>
      </Box>
      {result.dryRun && (
        <Box paddingTop={1}>
          <Text color="yellow">
            ℹ️  Dry run mode: Results were not persisted to database
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * UI Component: Error display screen for fatal workflow issues.
 * @param error Error message string
 */
function ErrorScreen({ error }: { error: string }) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="red" bold>
        ❌ Error
      </Text>
      <Text color="red">{error}</Text>
    </Box>
  );
}

/**
 * The main React component for interactive simulation workflow.
 *
 * Advances through a series of state transitions and renders the relevant UI component for each step.
 */
function InteractiveSimulationApp() {
  const { exit } = useApp();

  // Main local state tracking all workflow and form progress
  const [state, setState] = useState<AppState>({
    step: 'loading',
    strategies: [],
    callers: [],
  });

  // Initial load (strategies & callers)
  useEffect(() => {
    async function loadData() {
      try {
        await ensureInitialized();

        const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
        const strategiesRepo = new StrategiesRepository(dbPath);
        const strategies = await strategiesRepo.findAllActive();

        if (strategies.length === 0) {
          setState((s) => ({
            ...s,
            step: 'error',
            error: 'No active strategies found. Run: ts-node scripts/workflows/seed-strategies.ts',
          }));
          return;
        }

        const callersRepo = new CallersRepository(dbPath);
        const callers = await callersRepo.list();

        setState({
          step: 'strategy',
          strategies: strategies.map((s) => ({
            label: `${s.name} (v${s.version ?? '1'}) - ${s.description ?? 'No description'}`,
            value: s.name,
          })),
          callers: [
            { label: '(All callers)', value: undefined },
            ...callers.map((c) => ({
              label: `${c.source}/${c.handle}${c.displayName ? ` (${c.displayName})` : ''}`,
              value: `${c.source}/${c.handle}`,
            })),
          ],
        });
      } catch (error: unknown) {
        setState((s) => ({
          ...s,
          step: 'error',
          error: handleError(error),
        }));
      }
    }

    loadData();
  }, []);

  // Transition: strategy selection
  const handleStrategySelect = (strategy: string) => {
    setState((s) => ({ ...s, step: 'caller', selectedStrategy: strategy }));
  };

  // Transition: caller selection (set initial start date as today)
  const handleCallerSelect = (caller: string | undefined) => {
    const now = DateTime.utc();
    setState((s) => ({
      ...s,
      step: 'year-from',
      selectedCaller: caller,
      fromYear: now.year,
      fromMonth: now.month,
      fromDay: 1,
    }));
  };

  // Date selection transitions
  const handleFromYearSelect = (year: number) => {
    setState((s) => ({ ...s, step: 'month-from', fromYear: year }));
  };

  const handleFromMonthSelect = (month: number) => {
    setState((s) => ({ ...s, step: 'day-from', fromMonth: month }));
  };

  const handleFromDayComplete = (day: number) => {
    setState((s) => ({ ...s, step: 'year-to', fromDay: day, toYear: s.fromYear }));
  };

  const handleToYearSelect = (year: number) => {
    setState((s) => ({ ...s, step: 'month-to', toYear: year }));
  };

  const handleToMonthSelect = (month: number) => {
    setState((s) => ({ ...s, step: 'day-to', toMonth: month }));
  };

  const handleToDayComplete = (day: number) => {
    setState((s) => ({ ...s, step: 'pre-window', toDay: day }));
  };

  // Window selection transitions
  const handlePreWindowSelect = (minutes: number) => {
    setState((s) => ({ ...s, step: 'post-window', preWindow: minutes }));
  };

  const handlePostWindowSelect = (minutes: number) => {
    setState((s) => ({ ...s, step: 'dry-run', postWindow: minutes }));
  };

  // Dry run selection transition
  const handleDryRunConfirm = (dryRun: boolean) => {
    setState((s) => ({ ...s, step: 'summary', dryRun }));
  };

  // Confirmation triggers simulation
  const handleSummaryConfirm = async () => {
    setState((s) => ({ ...s, step: 'running' }));

    try {
      const ctx = createProductionContext();
      const fromDate = DateTime.utc(state.fromYear!, state.fromMonth!, state.fromDay!);
      const toDate = DateTime.utc(state.toYear!, state.toMonth!, state.toDay!);

      // Check date validity
      if (toDate <= fromDate) {
        setState((s) => ({
          ...s,
          step: 'error',
          error: 'End date must be after start date',
        }));
        return;
      }

      // Run the core workflow
      const result = await runSimulation(
        {
          strategyName: state.selectedStrategy!,
          callerName: state.selectedCaller,
          from: fromDate,
          to: toDate,
          options: {
            dryRun: state.dryRun,
            preWindowMinutes: state.preWindow,
            postWindowMinutes: state.postWindow,
          },
        },
        ctx
      );
      setState((s) => ({ ...s, step: 'results', result }));
    } catch (error: unknown) {
      setState((s) => ({
        ...s,
        step: 'error',
        error: handleError(error),
      }));
    }
  };

  // Cancel returns to CLI
  const handleSummaryCancel = () => {
    exit();
  };

  // Compute max valid days for current from/to month+year selection
  const maxDayFrom =
    state.fromYear && state.fromMonth
      ? DateTime.utc(state.fromYear, state.fromMonth, 1).daysInMonth ?? 31
      : 31;
  const maxDayTo =
    state.toYear && state.toMonth
      ? DateTime.utc(state.toYear, state.toMonth, 1).daysInMonth ?? 31
      : 31;

  // Common options for time windows before/after call
  const windowOptions = [
    { label: 'None (0 min)', value: 0 },
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '60 minutes (1 hour)', value: 60 },
    { label: '120 minutes (2 hours)', value: 120 },
  ];

  // Slightly longer for post-window
  const postWindowOptions = [
    { label: 'None (0 min)', value: 0 },
    { label: '30 minutes', value: 30 },
    { label: '60 minutes (1 hour)', value: 60 },
    { label: '120 minutes (2 hours)', value: 120 },
    { label: '240 minutes (4 hours)', value: 240 },
  ];

  // Main step rendering for the workflow
  switch (state.step) {
    case 'loading':
      return <LoadingScreen />;
    case 'strategy':
      return <StrategySelection strategies={state.strategies} onSelect={handleStrategySelect} />;
    case 'caller':
      return <CallerSelection callers={state.callers} onSelect={handleCallerSelect} />;
    case 'year-from':
      return <YearSelection label="Start Date" onSelect={handleFromYearSelect} />;
    case 'month-from':
      return <MonthSelection label="Start Date" onSelect={handleFromMonthSelect} />;
    case 'day-from':
      return (
        <DayInput
          label="Start Date"
          maxDay={maxDayFrom}
          defaultDay={state.fromDay!}
          onComplete={handleFromDayComplete}
        />
      );
    case 'year-to':
      return <YearSelection label="End Date" onSelect={handleToYearSelect} />;
    case 'month-to':
      return <MonthSelection label="End Date" onSelect={handleToMonthSelect} />;
    case 'day-to':
      return (
        <DayInput
          label="End Date"
          maxDay={maxDayTo}
          defaultDay={state.toDay!}
          onComplete={handleToDayComplete}
        />
      );
    case 'pre-window':
      return (
        <WindowSelection
          label="Pre-window (minutes before call)"
          options={windowOptions}
          onSelect={handlePreWindowSelect}
        />
      );
    case 'post-window':
      return (
        <WindowSelection
          label="Post-window (minutes after call)"
          options={postWindowOptions}
          onSelect={handlePostWindowSelect}
        />
      );
    case 'dry-run':
      return <DryRunConfirmation onConfirm={handleDryRunConfirm} />;
    case 'summary':
      return <SummaryScreen state={state} onConfirm={handleSummaryConfirm} onCancel={handleSummaryCancel} />;
    case 'running':
      return <RunningScreen />;
    case 'results':
      return <ResultsScreen result={state.result as SimulationResult} />;
    case 'error':
      return <ErrorScreen error={state.error!} />;
    default:
      return <Text>Unknown step</Text>;
  }
}

/**
 * Entrypoint: Run the interactive simulation workflow and render it to the terminal.
 * This function is launched by the CLI command defined below.
 * 
 * @returns {Promise<void>}
 */
export async function runInteractiveSimulation(): Promise<void> {
  render(<InteractiveSimulationApp />);
}

/**
 * Registers the interactive simulation command (sim/simulate) on a Commander program.
 * 
 * @param program Commander program instance to attach to
 */
export function registerInteractiveSimulationCommand(program: Command): void {
  program
    .command('sim')
    .alias('simulate')
    .description('🎯 Interactive simulation workflow (guided prompts)')
    .action(async () => {
      await runInteractiveSimulation();
    });
}
