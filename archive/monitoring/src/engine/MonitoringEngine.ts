/**
 * Monitoring Engine
 * =================
 * Core engine for live token monitoring orchestration.
 * Manages WebSocket connections, alert services, and call ingestion.
 */

import { logger } from '@quantbot/utils';
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
  bot?: import('telegraf').Telegraf;
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
    liveTradeAlerts: { running: boolean };
    tenkanKijunAlerts: { running: boolean };
    heliusMonitor: { running: boolean };
    brookIngestion: { running: boolean };
    curlyjoeIngestion: { running: boolean };
  };
}

/**
 * Monitoring Engine - Production-ready live monitoring orchestration
 */
export class MonitoringEngine {
  private liveTradeService: LiveTradeAlertService | null = null;
  private tenkanKijunService: TenkanKijunAlertService | null = null;
  private heliusMonitor: HeliusMonitor | null = null;
  private brookIngestion: BrookCallIngestion | null = null;
  private curlyjoeIngestion: CurlyJoeCallIngestion | null = null;
  private config: MonitoringEngineConfig;
  private isRunning = false;

  constructor(config: MonitoringEngineConfig) {
    this.config = config;
  }

  /**
   * Initialize all monitoring services
   */
  async initialize(): Promise<void> {
    logger.info('[MonitoringEngine] Initializing monitoring services');

    try {
      // Initialize live trade alert service
      if (this.config.enableLiveTradeAlerts) {
        this.liveTradeService = new LiveTradeAlertService();
        await this.liveTradeService.initialize();
        logger.info('[MonitoringEngine] Live trade alert service initialized');
      }

      // Initialize Tenkan/Kijun alert service
      if (this.config.enableTenkanKijunAlerts) {
        this.tenkanKijunService = new TenkanKijunAlertService();
        await this.tenkanKijunService.initialize();
        logger.info('[MonitoringEngine] Tenkan/Kijun alert service initialized');
      }

      // Initialize Helius monitor
      if (this.config.enableHeliusMonitor && this.config.bot) {
        this.heliusMonitor = new HeliusMonitor(this.config.bot);
        logger.info('[MonitoringEngine] Helius monitor initialized');
      }

      // Initialize Brook call ingestion
      if (this.config.enableBrookIngestion && this.config.botToken && this.config.brookChannelId) {
        this.brookIngestion = new BrookCallIngestion(
          this.config.botToken,
          this.config.brookChannelId,
          this.config.personalChatId,
          this.liveTradeService || undefined,
          this.tenkanKijunService || undefined
        );
        logger.info('[MonitoringEngine] Brook call ingestion initialized');
      }

      // Initialize CurlyJoe call ingestion
      if (
        this.config.enableCurlyJoeIngestion &&
        this.config.botToken &&
        this.config.curlyjoeChannelId
      ) {
        this.curlyjoeIngestion = new CurlyJoeCallIngestion(
          this.config.botToken,
          this.config.curlyjoeChannelId,
          this.liveTradeService || undefined
        );
        logger.info('[MonitoringEngine] CurlyJoe call ingestion initialized');
      }

      logger.info('[MonitoringEngine] All services initialized');
    } catch (error) {
      logger.error('[MonitoringEngine] Failed to initialize', error as Error);
      throw error;
    }
  }

  /**
   * Start all monitoring services
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[MonitoringEngine] Already running');
      return;
    }

    logger.info('[MonitoringEngine] Starting monitoring services');

    try {
      // Start live trade alerts
      if (this.liveTradeService) {
        await this.liveTradeService.start();
        logger.info('[MonitoringEngine] Live trade alerts started');
      }

      // Start Tenkan/Kijun alerts
      if (this.tenkanKijunService) {
        await this.tenkanKijunService.start();
        logger.info('[MonitoringEngine] Tenkan/Kijun alerts started');
      }

      // Start Helius monitor
      if (this.heliusMonitor) {
        await this.heliusMonitor.start();
        logger.info('[MonitoringEngine] Helius monitor started');
      }

      // Start Brook ingestion
      if (this.brookIngestion) {
        await this.brookIngestion.start();
        logger.info('[MonitoringEngine] Brook call ingestion started');
      }

      // Start CurlyJoe ingestion
      if (this.curlyjoeIngestion) {
        await this.curlyjoeIngestion.start();
        logger.info('[MonitoringEngine] CurlyJoe call ingestion started');
      }

      this.isRunning = true;
      logger.info('[MonitoringEngine] All services started');
    } catch (error) {
      logger.error('[MonitoringEngine] Failed to start', error as Error);
      throw error;
    }
  }

  /**
   * Stop all monitoring services
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('[MonitoringEngine] Not running');
      return;
    }

    logger.info('[MonitoringEngine] Stopping monitoring services');

    try {
      // Stop services in reverse order
      if (this.curlyjoeIngestion) {
        await this.curlyjoeIngestion.stop();
      }

      if (this.brookIngestion) {
        this.brookIngestion.stop();
      }

      if (this.heliusMonitor) {
        await this.heliusMonitor.stop();
      }

      if (this.tenkanKijunService) {
        await this.tenkanKijunService.stop();
      }

      if (this.liveTradeService) {
        await this.liveTradeService.stop();
      }

      this.isRunning = false;
      logger.info('[MonitoringEngine] All services stopped');
    } catch (error) {
      logger.error('[MonitoringEngine] Failed to stop', error as Error);
      throw error;
    }
  }

  /**
   * Get current status
   */
  getStatus(): MonitoringEngineStatus {
    return {
      isRunning: this.isRunning,
      services: {
        liveTradeAlerts: {
          running: this.liveTradeService?.getStatus()?.isRunning || false,
        },
        tenkanKijunAlerts: {
          running: this.tenkanKijunService?.isRunning() || false,
        },
        heliusMonitor: {
          running: this.heliusMonitor?.isRunning() || false,
        },
        brookIngestion: {
          running: this.brookIngestion ? true : false, // TODO: Add status method
        },
        curlyjoeIngestion: {
          running: this.curlyjoeIngestion ? true : false, // TODO: Add status method
        },
      },
    };
  }

  /**
   * Get service instances (for advanced usage)
   */
  getServices() {
    return {
      liveTradeService: this.liveTradeService,
      tenkanKijunService: this.tenkanKijunService,
      heliusMonitor: this.heliusMonitor,
      brookIngestion: this.brookIngestion,
      curlyjoeIngestion: this.curlyjoeIngestion,
    };
  }
}

// Singleton instance
let engineInstance: MonitoringEngine | null = null;

/**
 * Get monitoring engine instance
 */
export function getMonitoringEngine(config?: MonitoringEngineConfig): MonitoringEngine {
  if (!engineInstance && config) {
    engineInstance = new MonitoringEngine(config);
  }
  if (!engineInstance) {
    throw new Error('MonitoringEngine not initialized. Call getMonitoringEngine(config) first.');
  }
  return engineInstance;
}
