/**
 * Monitoring Engine
 * =================
 * Core engine for live token monitoring orchestration.
 * Manages WebSocket connections, alert services, and call ingestion.
 */
import { LiveTradeAlertService } from '../live-trade-alert-service';
import { TenkanKijunAlertService } from '../tenkan-kijun-alert-service';
import { HeliusMonitor } from '../helius-monitor';
import { BrookCallIngestion } from '../brook-call-ingestion';
import { CurlyJoeCallIngestion } from '../curlyjoe-call-ingestion';
export interface MonitoringEngineConfig {
  /** Enable live trade alerts */
  enableLiveTradeAlerts?: boolean;
  /** Enable Tenkan/Kijun alerts */
  enableTenkanKijunAlerts?: boolean;
  /** Enable Helius monitoring */
  enableHeliusMonitor?: boolean;
  /** Enable Brook call ingestion */
  enableBrookIngestion?: boolean;
  /** Enable CurlyJoe call ingestion */
  enableCurlyJoeIngestion?: boolean;
  /** Telegram bot instance (required for some services) */
  bot?: any;
  /** Bot token (required for call ingestion) */
  botToken?: string;
  /** Channel IDs */
  brookChannelId?: string;
  curlyjoeChannelId?: string;
  personalChatId?: string;
}
export interface MonitoringEngineStatus {
  isRunning: boolean;
  services: {
    liveTradeAlerts: {
      running: boolean;
    };
    tenkanKijunAlerts: {
      running: boolean;
    };
    heliusMonitor: {
      running: boolean;
    };
    brookIngestion: {
      running: boolean;
    };
    curlyjoeIngestion: {
      running: boolean;
    };
  };
}
/**
 * Monitoring Engine - Production-ready live monitoring orchestration
 */
export declare class MonitoringEngine {
  private liveTradeService;
  private tenkanKijunService;
  private heliusMonitor;
  private brookIngestion;
  private curlyjoeIngestion;
  private config;
  private isRunning;
  constructor(config: MonitoringEngineConfig);
  /**
   * Initialize all monitoring services
   */
  initialize(): Promise<void>;
  /**
   * Start all monitoring services
   */
  start(): Promise<void>;
  /**
   * Stop all monitoring services
   */
  stop(): Promise<void>;
  /**
   * Get current status
   */
  getStatus(): MonitoringEngineStatus;
  /**
   * Get service instances (for advanced usage)
   */
  getServices(): {
    liveTradeService: LiveTradeAlertService | null;
    tenkanKijunService: TenkanKijunAlertService | null;
    heliusMonitor: HeliusMonitor | null;
    brookIngestion: BrookCallIngestion | null;
    curlyjoeIngestion: CurlyJoeCallIngestion | null;
  };
}
/**
 * Get monitoring engine instance
 */
export declare function getMonitoringEngine(config?: MonitoringEngineConfig): MonitoringEngine;
//# sourceMappingURL=MonitoringEngine.d.ts.map
