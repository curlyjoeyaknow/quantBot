/**
 * Screen Manager - Screen stack, navigation, lifecycle
 */

import type { Screen, NavigationOptions } from '../types/index.js';
import { BlessedScreen } from './blessed-screen.js';

/**
 * Screen manager for handling screen navigation and lifecycle
 */
export class ScreenManager {
  private screens: Screen[] = [];
  private currentScreen: Screen | null = null;
  private blessedScreen: BlessedScreen | null = null;

  /**
   * Set blessed screen instance
   */
  setBlessedScreen(blessedScreen: BlessedScreen): void {
    this.blessedScreen = blessedScreen;
  }

  /**
   * Get blessed screen instance
   */
  getBlessedScreen(): BlessedScreen | null {
    return this.blessedScreen;
  }

  /**
   * Navigate to a screen
   */
  navigateTo(screen: Screen, options?: NavigationOptions): void {
    // Unmount current screen
    if (this.currentScreen) {
      this.currentScreen.onUnmount?.();
    }

    // Clear stack if requested
    if (options?.clearStack) {
      this.screens = [];
      if (this.blessedScreen) {
        this.blessedScreen.clear();
      }
    }

    // Replace current screen or add to stack
    if (options?.replace) {
      if (this.screens.length > 0) {
        this.screens[this.screens.length - 1] = screen;
      } else {
        this.screens.push(screen);
      }
    } else {
      this.screens.push(screen);
    }

    // Set current screen
    this.currentScreen = screen;

    // Mount new screen
    screen.onMount?.();

    // Render
    this.render();
  }

  /**
   * Navigate back
   */
  navigateBack(): boolean {
    if (this.screens.length <= 1) {
      return false;
    }

    // Unmount current screen
    if (this.currentScreen) {
      this.currentScreen.onUnmount?.();
    }

    // Remove current screen from stack
    this.screens.pop();

    // Set previous screen as current
    this.currentScreen = this.screens[this.screens.length - 1] ?? null;

    // Mount previous screen
    if (this.currentScreen) {
      this.currentScreen.onMount?.();
      this.render();
    }

    return true;
  }

  /**
   * Get current screen
   */
  getCurrentScreen(): Screen | null {
    return this.currentScreen;
  }

  /**
   * Get screen stack depth
   */
  getStackDepth(): number {
    return this.screens.length;
  }

  /**
   * Render current screen
   */
  render(): void {
    if (this.currentScreen) {
      this.currentScreen.render();
    }
    if (this.blessedScreen) {
      this.blessedScreen.render();
    }
  }

  /**
   * Handle keyboard input
   */
  handleInput(key: string): void {
    if (this.currentScreen && this.blessedScreen) {
      this.blessedScreen.handleTuiScreenInput(this.currentScreen, key);
    } else if (this.currentScreen) {
      this.currentScreen.handleInput(key);
    }
  }

  /**
   * Clear all screens
   */
  clear(): void {
    if (this.currentScreen) {
      this.currentScreen.onUnmount?.();
    }
    if (this.blessedScreen) {
      this.blessedScreen.clear();
    }
    this.screens = [];
    this.currentScreen = null;
  }
}
