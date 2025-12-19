/**
 * Keyboard Manager - Shortcut registration and handling
 */

import type { KeyboardShortcut } from '../types/index.js';

/**
 * Keyboard manager for handling shortcuts
 */
export class KeyboardManager {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private contextShortcuts: Map<string, Map<string, KeyboardShortcut>> = new Map();
  private currentContext: string | null = null;

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: KeyboardShortcut): () => void {
    const key = this.normalizeKey(shortcut.key);

    if (shortcut.context) {
      // Context-specific shortcut
      if (!this.contextShortcuts.has(shortcut.context)) {
        this.contextShortcuts.set(shortcut.context, new Map());
      }
      this.contextShortcuts.get(shortcut.context)!.set(key, shortcut);
    } else {
      // Global shortcut
      this.shortcuts.set(key, shortcut);
    }

    // Return unregister function
    return () => {
      if (shortcut.context) {
        this.contextShortcuts.get(shortcut.context)?.delete(key);
      } else {
        this.shortcuts.delete(key);
      }
    };
  }

  /**
   * Set current context
   */
  setContext(context: string | null): void {
    this.currentContext = context;
  }

  /**
   * Handle keyboard input
   */
  async handleKey(key: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(key);

    // Check context-specific shortcuts first
    if (this.currentContext) {
      const contextShortcuts = this.contextShortcuts.get(this.currentContext);
      const contextShortcut = contextShortcuts?.get(normalizedKey);
      if (contextShortcut) {
        await contextShortcut.handler();
        return true;
      }
    }

    // Check global shortcuts
    const shortcut = this.shortcuts.get(normalizedKey);
    if (shortcut) {
      await shortcut.handler();
      return true;
    }

    return false;
  }

  /**
   * Get all shortcuts for current context
   */
  getShortcuts(context?: string): KeyboardShortcut[] {
    const shortcuts: KeyboardShortcut[] = [];

    // Add global shortcuts
    shortcuts.push(...this.shortcuts.values());

    // Add context-specific shortcuts
    const ctx = context ?? this.currentContext;
    if (ctx) {
      const contextShortcuts = this.contextShortcuts.get(ctx);
      if (contextShortcuts) {
        shortcuts.push(...contextShortcuts.values());
      }
    }

    return shortcuts;
  }

  /**
   * Normalize key string (lowercase, normalize modifiers)
   */
  private normalizeKey(key: string): string {
    return key.toLowerCase().trim();
  }
}

/**
 * Global keyboard manager instance
 */
export const keyboardManager = new KeyboardManager();
