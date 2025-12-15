/**
 * TUI-specific type definitions
 */

/**
 * Screen interface
 */
export interface Screen {
  /**
   * Screen name/ID
   */
  name: string;

  /**
   * Render the screen
   */
  render(): void;

  /**
   * Handle keyboard input
   */
  handleInput(key: string): void;

  /**
   * Called when screen is mounted
   */
  onMount?(): void | Promise<void>;

  /**
   * Called when screen is unmounted
   */
  onUnmount?(): void | Promise<void>;
}

/**
 * Screen navigation options
 */
export interface NavigationOptions {
  /**
   * Replace current screen (don't add to stack)
   */
  replace?: boolean;

  /**
   * Clear screen stack
   */
  clearStack?: boolean;
}

/**
 * State subscription callback
 */
export type StateSubscription<T = unknown> = (state: T) => void;

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  /**
   * Key combination (e.g., 'ctrl+p', 'escape')
   */
  key: string;

  /**
   * Description for help text
   */
  description: string;

  /**
   * Handler function
   */
  handler: () => void | Promise<void>;

  /**
   * Context where shortcut is active (optional for global shortcuts)
   */
  context?: string;
}

/**
 * CLI command execution result
 */
export interface CLIExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  progress?: {
    current: number;
    total: number;
    label?: string;
  };
}
