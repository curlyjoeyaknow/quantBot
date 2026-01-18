/**
 * Alerting Service
 * ================
 * Alert system for critical failures and metric thresholds.
 */

import { logger } from '@quantbot/infra/utils';
import { getPrometheusMetrics } from './prometheus-metrics.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  source: string;
  timestamp: Date;
  resolved?: boolean;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: () => Promise<boolean> | boolean;
  severity: AlertSeverity;
  cooldownMinutes?: number; // Prevent alert spam
}

/**
 * Alert handlers (can be extended to send emails, Slack, etc.)
 */
export type AlertHandler = (alert: Alert) => Promise<void> | void;

/**
 * Alerting Service
 */
export class AlertingService {
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private handlers: AlertHandler[] = [];
  private lastAlertTime: Map<string, number> = new Map();
  private checkInterval?: NodeJS.Timeout;

  /**
   * Register an alert handler
   */
  registerHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Register an alert rule
   */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Start checking alert rules periodically
   */
  start(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      await this.checkRules();
    }, intervalMs);

    logger.info('Alerting service started', { intervalMs });
  }

  /**
   * Stop checking alert rules
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    logger.info('Alerting service stopped');
  }

  /**
   * Check all registered rules
   */
  async checkRules(): Promise<void> {
    for (const [ruleId, rule] of this.rules.entries()) {
      try {
        const triggered = await rule.condition();
        if (triggered) {
          await this.triggerAlert(ruleId, rule);
        }
      } catch (error) {
        logger.error('Error checking alert rule', error as Error, { ruleId, ruleName: rule.name });
      }
    }
  }

  /**
   * Trigger an alert
   */
  async triggerAlert(ruleId: string, rule: AlertRule): Promise<void> {
    // Check cooldown
    const lastTime = this.lastAlertTime.get(ruleId);
    const cooldownMs = (rule.cooldownMinutes || 5) * 60 * 1000;
    if (lastTime && Date.now() - lastTime < cooldownMs) {
      return; // Still in cooldown
    }

    // Check if alert already exists and is unresolved
    const existingAlert = Array.from(this.alerts.values()).find(
      (a) => a.source === ruleId && !a.resolved
    );
    if (existingAlert) {
      return; // Alert already active
    }

    const alert: Alert = {
      id: `${ruleId}_${Date.now()}`,
      title: rule.name,
      message: `Alert rule "${rule.name}" triggered`,
      severity: rule.severity,
      source: ruleId,
      timestamp: new Date(),
      resolved: false,
    };

    this.alerts.set(alert.id, alert);
    this.lastAlertTime.set(ruleId, Date.now());

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (error) {
        logger.error('Error in alert handler', error as Error, { alertId: alert.id });
      }
    }

    logger.warn('Alert triggered', {
      alertId: alert.id,
      ruleId,
      severity: alert.severity,
      title: alert.title,
    });
  }

  /**
   * Manually create an alert
   */
  async createAlert(
    title: string,
    message: string,
    severity: AlertSeverity,
    source: string = 'manual',
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const alert: Alert = {
      id: `${source}_${Date.now()}`,
      title,
      message,
      severity,
      source,
      timestamp: new Date(),
      resolved: false,
      metadata,
    };

    this.alerts.set(alert.id, alert);

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (error) {
        logger.error('Error in alert handler', error as Error, { alertId: alert.id });
      }
    }

    logger.warn('Alert created', {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title,
    });

    return alert.id;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      logger.warn('Alert not found', { alertId });
      return;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();

    logger.info('Alert resolved', { alertId, title: alert.title });
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(severity?: AlertSeverity): Alert[] {
    const alerts = Array.from(this.alerts.values()).filter((a) => !a.resolved);
    if (severity) {
      return alerts.filter((a) => a.severity === severity);
    }
    return alerts;
  }

  /**
   * Get all alerts
   */
  getAllAlerts(severity?: AlertSeverity): Alert[] {
    const alerts = Array.from(this.alerts.values());
    if (severity) {
      return alerts.filter((a) => a.severity === severity);
    }
    return alerts;
  }
}

/**
 * Singleton instance
 */
let alertingInstance: AlertingService | null = null;

/**
 * Get or create the singleton AlertingService instance
 */
export function getAlertingService(): AlertingService {
  if (!alertingInstance) {
    alertingInstance = new AlertingService();

    // Register default alert rules
    registerDefaultAlertRules(alertingInstance);
  }
  return alertingInstance;
}

/**
 * Register default alert rules
 */
function registerDefaultAlertRules(service: AlertingService): void {
  // Low API credits alert
  service.registerRule({
    id: 'low_api_credits',
    name: 'Low API Credits',
    severity: 'warning',
    cooldownMinutes: 30,
    condition: async () => {
      // Check Prometheus metrics for low credits
      const metrics = getPrometheusMetrics();
      // This is a simplified check - in production, query actual metrics
      return false; // Placeholder
    },
  });

  // Circuit breaker tripped alert
  service.registerRule({
    id: 'circuit_breaker_tripped',
    name: 'Circuit Breaker Tripped',
    severity: 'critical',
    cooldownMinutes: 5,
    condition: async () => {
      const metrics = getPrometheusMetrics();
      // Check if any circuit breaker is tripped
      // This is a simplified check - in production, query actual metrics
      return false; // Placeholder
    },
  });

  // High error rate alert
  service.registerRule({
    id: 'high_error_rate',
    name: 'High Error Rate',
    severity: 'critical',
    cooldownMinutes: 10,
    condition: async () => {
      // Check error rate from metrics
      return false; // Placeholder
    },
  });
}

/**
 * Default console alert handler
 */
export function createConsoleAlertHandler(): AlertHandler {
  return (alert: Alert) => {
    const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    console.error(
      `${emoji} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`,
      alert.metadata
    );
  };
}
