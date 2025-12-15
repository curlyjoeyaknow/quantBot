/**
 * Screen Manager - Screen stack, navigation, lifecycle
 */

import type { Screen, NavigationOptions } from '../types';

/**
 * Screen manager for handling screen navigation and lifecycle
 */
export class ScreenManager {
  private screens: Screen[] = [];
  private currentScreen: Screen | null = null;

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
  }

  /**
   * Handle keyboard input
   */
  handleInput(key: string): void {
    if (this.currentScreen) {
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
    this.screens = [];
    this.currentScreen = null;
  }
}
