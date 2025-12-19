/**
 * Simulation Runner Screen
 */

import type { Screen } from '../types/index.js';
import { executeCLICommand } from '../core/cli-bridge.js';

/**
 * Simulation runner screen implementation
 */
export class SimulationRunnerScreen implements Screen {
  name = 'simulation-runner';
  private strategy = '';
  private caller = '';
  private fromDate = '';
  private toDate = '';
  private running = false;
  private result: unknown = null;

  render(): void {
    console.clear();
    console.log('[bold]Simulation Runner[/bold]');
    console.log('');

    if (this.running) {
      console.log('Running simulation...');
      return;
    }

    console.log('Strategy:', this.strategy || '(not set)');
    console.log('Caller:', this.caller || '(not set)');
    console.log('From:', this.fromDate || '(not set)');
    console.log('To:', this.toDate || '(not set)');
    console.log('');

    if (this.result) {
      console.log('Result:');
      console.log(JSON.stringify(this.result, null, 2));
    } else {
      console.log('Configure parameters and run simulation');
    }
  }

  async runSimulation(): Promise<void> {
    if (!this.strategy || !this.fromDate || !this.toDate) {
      return;
    }

    this.running = true;
    this.render();

    try {
      const result = await executeCLICommand('simulation', 'run', {
        strategy: this.strategy,
        caller: this.caller,
        from: this.fromDate,
        to: this.toDate,
      });

      this.result = result.data;
    } catch (error) {
      // Handle error
    } finally {
      this.running = false;
      this.render();
    }
  }

  handleInput(key: string): void {
    // Handle input for form fields
    if (key === 'escape') {
      // Navigate back
      return;
    }
  }
}
