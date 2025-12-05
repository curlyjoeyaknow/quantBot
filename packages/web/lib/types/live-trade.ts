/**
 * Live Trade Alert Types
 */

export interface LiveTradeStrategy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: 'entry' | 'indicator';
}

export interface LiveTradeStrategyConfig {
  strategies: LiveTradeStrategy[];
  entryConfig: {
    initialEntry: number | 'none';
    trailingEntry: number | 'none';
    maxWaitTime: number;
  };
}

export interface LiveTradeStatus {
  isRunning: boolean;
  monitoredTokens: number;
  websocketConnected: boolean;
  alertGroups: number;
}

