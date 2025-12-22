/**
 * Command Palette Screen - Fuzzy search for commands
 */

import type { Screen } from '../types/index.js';
import { commandRegistry } from '@quantbot/cli';

/**
 * Command palette screen implementation
 */
export class CommandPaletteScreen implements Screen {
  name = 'command-palette';
  private searchQuery = '';
  private selectedIndex = 0;
  private commands: Array<{ package: string; command: string; description: string }> = [];

  onMount(): void {
    // Load all commands
    this.loadCommands();
  }

  private loadCommands(): void {
    const packages = commandRegistry.getPackages();
    this.commands = [];

    for (const pkg of packages) {
      for (const cmd of pkg.commands) {
        this.commands.push({
          package: pkg.packageName,
          command: cmd.name,
          description: cmd.description,
        });
      }
    }
  }

  private getFilteredCommands(): Array<{ package: string; command: string; description: string }> {
    if (!this.searchQuery) {
      return this.commands;
    }

    const query = this.searchQuery.toLowerCase();
    return this.commands.filter(
      (cmd) =>
        cmd.package.toLowerCase().includes(query) ||
        cmd.command.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query)
    );
  }

  render(): void {
    console.clear();
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Command Palette (Type to search, Esc to close)');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    if (this.searchQuery) {
      console.log(`Search: ${this.searchQuery}`);
    } else {
      console.log('Search: (type to filter commands)');
    }

    console.log('');

    const filtered = this.getFilteredCommands();
    for (let i = 0; i < filtered.length && i < 20; i++) {
      const cmd = filtered[i]!;
      const prefix = i === this.selectedIndex ? '[bold]>[/bold] ' : '  ';
      console.log(`${prefix}${cmd.package} ${cmd.command} - ${cmd.description}`);
    }
  }

  handleInput(key: string): void {
    if (key === 'escape') {
      // Close palette - would navigate back
      return;
    }

    if (key === 'enter') {
      // Execute selected command
      const filtered = this.getFilteredCommands();
      if (filtered[this.selectedIndex]) {
        const cmd = filtered[this.selectedIndex]!;
        // Execute command
        console.log(`Executing: ${cmd.package} ${cmd.command}`);
      }
      return;
    }

    if (key === 'arrowup') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.render();
      return;
    }

    if (key === 'arrowdown') {
      const filtered = this.getFilteredCommands();
      this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 1);
      this.render();
      return;
    }

    // Handle text input
    if (key.length === 1) {
      this.searchQuery += key;
      this.selectedIndex = 0;
      this.render();
    } else if (key === 'backspace') {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.selectedIndex = 0;
      this.render();
    }
  }
}
