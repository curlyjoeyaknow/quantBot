/**
 * Log Monitoring Utilities
 * ========================
 * Real-time log monitoring, alerting, and analytics.
 */

import { Logger } from '../logger.js';
import { EventEmitter } from 'events';

/**
 * Log pattern for monitoring
 */
export interface LogPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Log level to monitor */
  level?: 'error' | 'warn' | 'info' | 'debug';
  /** Message pattern (regex or string) */
  messagePattern?: string | RegExp;
  /** Namespace pattern */
  namespacePattern?: string | RegExp;
  /** Threshold count before alerting */
  threshold?: number;
  /** Time window in milliseconds */
  timeWindow?: number;
  /** Callback when pattern matches */
  onMatch?: (log: Record<string, unknown>) => void;
}

/**
 * Log monitor for pattern detection and alerting
 */
export class LogMonitor extends EventEmitter {
  private patterns: Map<string, LogPattern> = new Map();
  private patternCounts: Map<string, { count: number; firstSeen: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();

    // Cleanup old pattern counts every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupPatternCounts();
    }, 60000);
  }

  /**
   * Register a log pattern to monitor
   */
  registerPattern(pattern: LogPattern): void {
    this.patterns.set(pattern.id, {
      threshold: 1,
      timeWindow: 60000, // 1 minute default
      ...pattern,
    });
  }

  /**
   * Unregister a log pattern
   */
  unregisterPattern(patternId: string): void {
    this.patterns.delete(patternId);
    this.patternCounts.delete(patternId);
  }

  /**
   * Process a log entry
   */
  processLog(log: Record<string, unknown>): void {
    for (const [id, pattern] of this.patterns) {
      if (this.matchesPattern(log, pattern)) {
        this.handleMatch(id, pattern, log);
      }
    }
  }

  /**
   * Check if log matches pattern
   */
  private matchesPattern(log: Record<string, unknown>, pattern: LogPattern): boolean {
    // Check level
    if (pattern.level && log.level !== pattern.level) {
      return false;
    }

    // Check namespace
    if (pattern.namespacePattern) {
      const namespaceRegex =
        typeof pattern.namespacePattern === 'string'
          ? new RegExp(pattern.namespacePattern)
          : pattern.namespacePattern;

      const namespace = typeof log.namespace === 'string' ? log.namespace : '';
      if (!namespaceRegex.test(namespace)) {
        return false;
      }
    }

    // Check message pattern
    if (pattern.messagePattern) {
      const messageRegex =
        typeof pattern.messagePattern === 'string'
          ? new RegExp(pattern.messagePattern)
          : pattern.messagePattern;

      const message = typeof log.message === 'string' ? log.message : '';
      if (!messageRegex.test(message)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Handle pattern match
   */
  private handleMatch(id: string, pattern: LogPattern, log: Record<string, unknown>): void {
    const now = Date.now();
    const countData = this.patternCounts.get(id);

    if (!countData) {
      this.patternCounts.set(id, { count: 1, firstSeen: now });
    } else {
      // Check if within time window
      if (now - countData.firstSeen <= (pattern.timeWindow || 60000)) {
        countData.count++;
      } else {
        // Reset count and window
        this.patternCounts.set(id, { count: 1, firstSeen: now });
      }
    }

    const currentCount = this.patternCounts.get(id)!.count;

    // Trigger alert if threshold exceeded
    if (currentCount >= (pattern.threshold || 1)) {
      this.emit('alert', {
        patternId: id,
        patternName: pattern.name,
        count: currentCount,
        timeWindow: pattern.timeWindow,
        log,
      });

      // Call pattern callback
      if (pattern.onMatch) {
        pattern.onMatch(log);
      }

      // Reset count after alert
      this.patternCounts.delete(id);
    }
  }

  /**
   * Cleanup old pattern counts outside time window
   */
  private cleanupPatternCounts(): void {
    const now = Date.now();

    for (const [id, countData] of this.patternCounts) {
      const pattern = this.patterns.get(id);
      if (!pattern) continue;

      const timeWindow = pattern.timeWindow || 60000;
      if (now - countData.firstSeen > timeWindow) {
        this.patternCounts.delete(id);
      }
    }
  }

  /**
   * Get current pattern statistics
   */
  getStatistics(): Map<string, { count: number; firstSeen: number }> {
    return new Map(this.patternCounts);
  }

  /**
   * Stop monitoring and cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.removeAllListeners();
  }
}

/**
 * Common log patterns for monitoring
 */
export const CommonPatterns = {
  /**
   * Database connection errors
   */
  databaseErrors: (): LogPattern => ({
    id: 'database-errors',
    name: 'Database Connection Errors',
    level: 'error',
    messagePattern: /database|connection|pool|timeout/i,
    threshold: 5,
    timeWindow: 60000,
  }),

  /**
   * API rate limit errors
   */
  rateLimitErrors: (): LogPattern => ({
    id: 'rate-limit-errors',
    name: 'API Rate Limit Errors',
    level: 'error',
    messagePattern: /rate limit|429|too many requests/i,
    threshold: 3,
    timeWindow: 300000, // 5 minutes
  }),

  /**
   * Authentication failures
   */
  authFailures: (): LogPattern => ({
    id: 'auth-failures',
    name: 'Authentication Failures',
    level: 'error',
    messagePattern: /auth|unauthorized|401|403/i,
    threshold: 5,
    timeWindow: 60000,
  }),

  /**
   * WebSocket disconnections
   */
  websocketDisconnects: (): LogPattern => ({
    id: 'websocket-disconnects',
    name: 'WebSocket Disconnections',
    level: 'warn',
    messagePattern: /websocket|disconnect|closed/i,
    threshold: 3,
    timeWindow: 120000, // 2 minutes
  }),

  /**
   * High memory usage warnings
   */
  memoryWarnings: (): LogPattern => ({
    id: 'memory-warnings',
    name: 'High Memory Usage',
    level: 'warn',
    messagePattern: /memory|heap|oom/i,
    threshold: 1,
    timeWindow: 300000, // 5 minutes
  }),
};

/**
 * Global log monitor instance
 */
let globalMonitor: LogMonitor | null = null;

/**
 * Initialize global log monitor
 */
export function initializeLogMonitor(): LogMonitor {
  if (!globalMonitor) {
    globalMonitor = new LogMonitor();

    // Register common patterns
    globalMonitor.registerPattern(CommonPatterns.databaseErrors());
    globalMonitor.registerPattern(CommonPatterns.rateLimitErrors());
    globalMonitor.registerPattern(CommonPatterns.authFailures());
    globalMonitor.registerPattern(CommonPatterns.websocketDisconnects());
    globalMonitor.registerPattern(CommonPatterns.memoryWarnings());
  }

  return globalMonitor;
}

/**
 * Get global log monitor
 */
export function getLogMonitor(): LogMonitor | null {
  return globalMonitor;
}
