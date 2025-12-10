import { DateTime } from 'luxon';
import type { StopLossConfig, EntryConfig, ReEntryConfig } from '@quantbot/simulation/config';
import type { Strategy } from '@quantbot/simulation/engine';
import type { Candle } from '@quantbot/simulation/candles';
import type {
  TokenMetadata,
  CallerInfo,
  SimulationRunData,
  SimulationEvent,
  LastSimulation,
  CACall,
} from '@quantbot/utils/types';

export interface ActiveCA {
  id: number;
  mint: string;
  chain: string;
  token_name?: string;
  token_symbol?: string;
  call_price?: number;
  call_marketcap?: number;
  alert_timestamp?: number;
  caller?: string;
  created_at?: string;
}

export type BotCACall = CACall & {
  call_timestamp?: number;
  caller?: string;
};

export type {
  TokenMetadata,
  CallerInfo,
  SimulationRunData,
  SimulationEvent,
  LastSimulation,
  CACall,
};

export interface SessionData {
  [key: string]: unknown;
  waitingManualInput?: string;
  waitingForRunSelection?: boolean;
  mint?: string;
  chain?: string;
  datetime?: DateTime | string;
  metadata?: TokenMetadata;
  callerInfo?: CallerInfo;
  strategy?: Strategy[];
  stopLossConfig?: StopLossConfig;
  entryConfig?: EntryConfig;
  reEntryConfig?: ReEntryConfig;
  recentRuns?: SimulationRunData[];
}

export interface Session {
  step?: string;
  type?: string;
  data?: SessionData;
  mint?: string;
  chain?: string;
  datetime?: DateTime;
  metadata?: TokenMetadata;
  callerInfo?: CallerInfo;
  strategy?: Strategy[];
  stopLossConfig?: StopLossConfig;
  entryConfig?: EntryConfig;
  reEntryConfig?: ReEntryConfig;
  lastSimulation?: LastSimulation;
  waitingForRunSelection?: boolean;
  recentRuns?: SimulationRunData[];
  userId?: number;
  strategyName?: string;
  [key: string]: unknown;
}

