/**
 * Main TUI Application
 */

import { ScreenManager } from './core/screen-manager';
import { StateManager } from './core/state-manager';
import { keyboardManager } from './core/keyboard-manager';
import { eventBus } from './core/event-bus';
import type { Screen } from './types';

/**
 * TUI Application state
 */
interface AppState {
  initialized: boolean;
  currentScreen: string | null;
}

/**
 * Main TUI application class
 */
export class TUIApp {
  private screenManager: ScreenManager;
  private stateManager: StateManager<AppState>;
  private running: boolean = false;

  constructor() {
    this.screenManager = new ScreenManager();
    this.stateManager = new StateManager<AppState>({
      initialized: false,
      currentScreen: null,
    });

    // Subscribe to state changes
    this.stateManager.subscribe((state) => {
      // Update screen if needed
      if (state.currentScreen) {
        this.screenManager.render();
      }
    });
  }

  /**
   * Initialize the TUI application
   */
  async initialize(): Promise<void> {
    // Register global keyboard shortcuts
    keyboardManager.register({
      key: 'ctrl+q',
      description: 'Quit application',
      handler: () => {
        this.quit();
      },
    });

    keyboardManager.register({
      key: 'escape',
      description: 'Go back',
      handler: () => {
        this.screenManager.navigateBack();
      },
    });

    this.stateManager.setState((prev) => ({ ...prev, initialized: true }));
  }

  /**
   * Navigate to a screen
   */
  navigateTo(screen: Screen): void {
    this.screenManager.navigateTo(screen);
    this.stateManager.setState((prev) => ({ ...prev, currentScreen: screen.name }));
  }

  /**
   * Handle keyboard input
   */
  async handleInput(key: string): Promise<void> {
    // Try keyboard manager first
    const handled = await keyboardManager.handleKey(key);
    if (!handled) {
      // Pass to current screen
      this.screenManager.handleInput(key);
    }
  }

  /**
   * Start the TUI application
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.initialize();

    // Set up input handling (simplified - would use readline in real implementation)
    // This is a placeholder for the actual input handling
    eventBus.emit('app:started');
  }

  /**
   * Stop the TUI application
   */
  quit(): void {
    this.running = false;
    this.screenManager.clear();
    eventBus.emit('app:quit');
  }

  /**
   * Check if app is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get screen manager
   */
  getScreenManager(): ScreenManager {
    return this.screenManager;
  }

  /**
   * Get state manager
   */
  getStateManager(): StateManager<AppState> {
    return this.stateManager;
  }
}
