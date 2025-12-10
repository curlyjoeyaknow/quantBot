/**
 * Core bot types and interfaces
 */

import { TradingStrategy } from './simulation';

export interface BotConfig {
  token: string;
  defaultChat: string;
  adminUsers: string[];
}

export interface BotContext {
  userId: string;
  chatId: string;
  username?: string;
  isAdmin: boolean;
}

export interface BotCommand {
  command: string;
  description: string;
  handler: (ctx: BotContext) => Promise<void>;
  adminOnly?: boolean;
}

export interface BotState {
  currentSession?: SimulationSession;
  userStates: Map<string, UserState>;
}

export interface UserState {
  step: string;
  data: Record<string, any>;
  lastActivity: Date;
}

export interface SimulationSession {
  id: string;
  userId: string;
  tokenAddress: string;
  chain: string;
  startTime: Date;
  strategy: TradingStrategy;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: Date;
}
