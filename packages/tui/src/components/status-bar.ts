/**
 * Status Bar Component
 */

/**
 * Status bar information
 */
export interface StatusBarInfo {
  systemStatus?: 'healthy' | 'degraded' | 'unhealthy';
  connectionStatus?: 'connected' | 'disconnected';
  lastUpdate?: Date;
  shortcuts?: Array<{ key: string; description: string }>;
}

/**
 * Render status bar
 */
export function renderStatusBar(info: StatusBarInfo): string {
  const parts: string[] = [];

  if (info.systemStatus) {
    const icon = info.systemStatus === 'healthy' ? '✅' : '⚠️';
    parts.push(`${icon} ${info.systemStatus}`);
  }

  if (info.connectionStatus) {
    const icon = info.connectionStatus === 'connected' ? '🟢' : '🔴';
    parts.push(`${icon} ${info.connectionStatus}`);
  }

  if (info.lastUpdate) {
    parts.push(`Updated: ${info.lastUpdate.toLocaleTimeString()}`);
  }

  if (info.shortcuts && info.shortcuts.length > 0) {
    const shortcuts = info.shortcuts.map((s) => `${s.key}: ${s.description}`).join(' | ');
    parts.push(shortcuts);
  }

  return parts.join(' | ');
}
