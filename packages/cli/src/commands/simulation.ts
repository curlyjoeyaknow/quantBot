/**
 * Simulation Commands (DEPRECATED)
 *
 * @deprecated This command is deprecated. Use 'backtest' instead.
 * This file exists for backward compatibility only.
 *
 * Backtest = Deterministic replay over historical data
 * - Same inputs → same outputs
 * - No randomness
 * - Uses actual historical candles
 * - Produces auditable trades + events + replay
 */

import type { Command } from 'commander';
import { commandRegistry } from '../core/command-registry.js';
import { registerBacktestCommands } from './backtest.js';

/**
 * Register simulation commands (deprecated alias for backtest)
 *
 * @deprecated Use registerBacktestCommands instead
 */
export function registerSimulationCommands(program: Command): void {
  // Register backtest commands first (they register themselves in commandRegistry)
  registerBacktestCommands(program);

  // Create deprecated simulation command that delegates to backtest
  const simCmd = program
    .command('simulation')
    .alias('sim')
    .description('Trading strategy backtest operations (deprecated: use "backtest" instead)')
    .hook('preAction', () => {
      console.warn(
        '\n⚠️  DEPRECATION WARNING:\n' +
          '   The "simulation" command is deprecated and will be removed in a future version.\n' +
          '   Please use "backtest" instead:\n' +
          '   - quantbot simulation run → quantbot backtest run\n' +
          '   - quantbot sim → quantbot backtest\n\n'
      );
    });

  // Get the backtest command to copy its subcommands
  const backtestCmd = program.commands.find((cmd) => cmd.name() === 'backtest');
  if (!backtestCmd) {
    // If backtest isn't registered yet, just return (it will be registered by the import above)
    return;
  }

  // Copy all subcommands from backtest to simulation
  backtestCmd.commands.forEach((backtestSubCmd) => {
    const simSubCmd = simCmd
      .command(backtestSubCmd.name())
      .description(
        (backtestSubCmd.description() || '') +
          ' (deprecated: use "backtest ' +
          backtestSubCmd.name() +
          '" instead)'
      );

    // Copy all options
    backtestSubCmd.options.forEach((opt) => {
      const flags = opt.flags;
      const description = opt.description;
      const defaultValue = opt.defaultValue;
      if (opt.required) {
        simSubCmd.requiredOption(flags, description, defaultValue);
      } else {
        simSubCmd.option(flags, description, defaultValue);
      }
    });

    // Wire to backtest handler via execute
    simSubCmd.action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('backtest', backtestSubCmd.name());
      if (commandDef) {
        await execute(commandDef, options);
      } else {
        console.error(`Error: Command "backtest ${backtestSubCmd.name()}" not found`);
        process.exit(1);
      }
    });
  });
}
