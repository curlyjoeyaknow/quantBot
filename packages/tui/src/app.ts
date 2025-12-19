/**
 * Main TUI Application
 */

import { ScreenManager } from './core/screen-manager.js';
import { StateManager } from './core/state-manager.js';
import { keyboardManager } from './core/keyboard-manager.js';
import { eventBus } from './core/event-bus.js';
import { BlessedScreen } from './core/blessed-screen.js';
import type { Screen } from './types/index.js';

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
  private blessedScreen: BlessedScreen;
  private running: boolean = false;

  constructor() {
    this.blessedScreen = new BlessedScreen();
    this.screenManager = new ScreenManager();
    this.screenManager.setBlessedScreen(this.blessedScreen);
    
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

    // Set up blessed screen key handlers
    this.blessedScreen.onKey(['q', 'C-c'], () => {
      this.quit();
    });

    this.blessedScreen.onKey(['escape'], () => {
      this.screenManager.navigateBack();
    });

    // Set up global key handler to forward to current screen
    const screen = this.blessedScreen.getScreen();
    screen.on('keypress', (ch: string | undefined, key: { name?: string; full?: string; ctrl?: boolean; shift?: boolean }) => {
      const currentScreen = this.screenManager.getCurrentScreen();
      if (currentScreen) {
        this.blessedScreen.handleBlessedKeypress(currentScreen, ch, key);
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

    // Initial render
    this.screenManager.render();
    eventBus.emit('app:started');
  }

  /**
   * Stop the TUI application
   */
  quit(): void {
    this.running = false;
    this.screenManager.clear();
    this.blessedScreen.destroy();
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

  /**
   * Get blessed screen
   */
  getBlessedScreen(): BlessedScreen {
    return this.blessedScreen;
  }
}
