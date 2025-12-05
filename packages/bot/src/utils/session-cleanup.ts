/**
 * Session Cleanup Utilities
 * =========================
 * Utilities for cleaning up expired sessions and managing session lifecycle.
 */

import { SessionService } from '@quantbot/services/SessionService';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';

/**
 * Session expiration configuration
 */
export const SESSION_CONFIG = {
  DEFAULT_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  WARNING_TIME_MS: 25 * 60 * 1000,    // 25 minutes (warn at 25 min)
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,  // Cleanup every 5 minutes
} as const;

/**
 * Session metadata for tracking expiration
 */
export interface SessionMetadata {
  createdAt: DateTime;
  lastActivity: DateTime;
  expiresAt: DateTime;
}

/**
 * Session cleanup manager
 */
export class SessionCleanupManager {
  private sessionMetadata: Map<number, SessionMetadata> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  private sessionService: SessionService;

  constructor(sessionService: SessionService) {
    this.sessionService = sessionService;
  }

  /**
   * Start automatic session cleanup
   */
  start(): void {
    if (this.cleanupInterval) {
      return; // Already started
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, SESSION_CONFIG.CLEANUP_INTERVAL_MS);

    logger.info('Session cleanup manager started', {
      cleanupInterval: SESSION_CONFIG.CLEANUP_INTERVAL_MS,
      defaultTimeout: SESSION_CONFIG.DEFAULT_TIMEOUT_MS,
    });
  }

  /**
   * Stop automatic session cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      logger.info('Session cleanup manager stopped');
    }
  }

  /**
   * Register a session with expiration tracking
   */
  registerSession(userId: number, timeoutMs: number = SESSION_CONFIG.DEFAULT_TIMEOUT_MS): void {
    const now = DateTime.utc();
    this.sessionMetadata.set(userId, {
      createdAt: now,
      lastActivity: now,
      expiresAt: now.plus({ milliseconds: timeoutMs }),
    });
  }

  /**
   * Update last activity time for a session
   */
  updateActivity(userId: number): void {
    const metadata = this.sessionMetadata.get(userId);
    if (metadata) {
      const now = DateTime.utc();
      const timeRemaining = metadata.expiresAt.diff(now).as('milliseconds');
      
      // Extend expiration if session is still active
      metadata.lastActivity = now;
      metadata.expiresAt = now.plus({ milliseconds: Math.max(timeRemaining, SESSION_CONFIG.DEFAULT_TIMEOUT_MS) });
    }
  }

  /**
   * Check if a session is expired
   */
  isExpired(userId: number): boolean {
    const metadata = this.sessionMetadata.get(userId);
    if (!metadata) {
      return true; // No metadata means expired
    }
    return DateTime.utc() >= metadata.expiresAt;
  }

  /**
   * Check if a session should receive a warning (approaching expiration)
   */
  shouldWarn(userId: number): boolean {
    const metadata = this.sessionMetadata.get(userId);
    if (!metadata) {
      return false;
    }
    const timeUntilExpiry = metadata.expiresAt.diff(DateTime.utc()).as('milliseconds');
    return timeUntilExpiry > 0 && timeUntilExpiry <= SESSION_CONFIG.WARNING_TIME_MS;
  }

  /**
   * Get time remaining until expiration (in seconds)
   */
  getTimeRemaining(userId: number): number | null {
    const metadata = this.sessionMetadata.get(userId);
    if (!metadata) {
      return null;
    }
    const diff = metadata.expiresAt.diff(DateTime.utc()).as('seconds');
    return diff > 0 ? Math.floor(diff) : 0;
  }

  /**
   * Remove session metadata
   */
  unregisterSession(userId: number): void {
    this.sessionMetadata.delete(userId);
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = DateTime.utc();
    const expiredUserIds: number[] = [];

    for (const [userId, metadata] of this.sessionMetadata.entries()) {
      if (now >= metadata.expiresAt) {
        expiredUserIds.push(userId);
      }
    }

    if (expiredUserIds.length > 0) {
      logger.info('Cleaning up expired sessions', {
        count: expiredUserIds.length,
        userIds: expiredUserIds,
      });

      for (const userId of expiredUserIds) {
        this.sessionService.clearSession(userId);
        this.unregisterSession(userId);
      }
    }
  }

  /**
   * Get statistics about active sessions
   */
  getStats(): {
    totalSessions: number;
    expiredSessions: number;
    activeSessions: number;
  } {
    const now = DateTime.utc();
    let expiredCount = 0;

    for (const metadata of this.sessionMetadata.values()) {
      if (now >= metadata.expiresAt) {
        expiredCount++;
      }
    }

    return {
      totalSessions: this.sessionMetadata.size,
      expiredSessions: expiredCount,
      activeSessions: this.sessionMetadata.size - expiredCount,
    };
  }
}

