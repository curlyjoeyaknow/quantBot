/**
 * HeliusMonitor (Refactored)
 * ==========================
 * Orchestrates WebSocket connection management and CA monitoring.
 * Separated concerns for better modularity and testability.
 */

import { WebSocketConnectionManager, WebSocketConfig } from '../websocket/WebSocketConnectionManager';
import { CAMonitoringService, CAMonitor, PriceUpdateEvent } from '../monitoring/CAMonitoringService';

export interface HeliusMonitorConfig {
  apiKey: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

/**
 * HeliusMonitor Class
 * Orchestrates WebSocket management and CA monitoring
 */
export class HeliusMonitor {
  private wsManager: WebSocketConnectionManager;
  private monitoringService: CAMonitoringService;
  private config: HeliusMonitorConfig;
  private bot: any;
  private isRunning: boolean = false;
  private summaryTimer: NodeJS.Timeout | null = null;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(bot: any, config: HeliusMonitorConfig) {
    this.bot = bot;
    this.config = config;
    
    // Initialize WebSocket manager
    const wsConfig: WebSocketConfig = {
      url: `wss://mainnet.helius-rpc.com/?api-key=${config.apiKey}`,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      reconnectDelay: config.reconnectDelay || 1000,
      heartbeatInterval: config.heartbeatInterval || 30000
    };
    
    this.wsManager = new WebSocketConnectionManager(wsConfig);
    
    // Initialize monitoring service
    this.monitoringService = new CAMonitoringService(bot);
    
    this.setupEventHandlers();
  }

  /**
   * Start the monitor
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('HeliusMonitor is already running');
      return;
    }

    console.log('Starting Helius WebSocket monitoring...');
    
    try {
      // Initialize monitoring service
      await this.monitoringService.initialize();
      
      // Connect WebSocket
      await this.wsManager.connect();
      
      // Start scheduled tasks
      this.scheduleHourlySummaries();
      this.startPeriodicUpdateRequests();
      
      this.isRunning = true;
      console.log('HeliusMonitor started successfully');
    } catch (error) {
      console.error('Failed to start HeliusMonitor:', error);
      throw error;
    }
  }

  /**
   * Stop the monitor
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('HeliusMonitor is not running');
      return;
    }

    console.log('Stopping HeliusMonitor...');
    
    // Clear timers
    this.clearTimers();
    
    // Disconnect WebSocket
    this.wsManager.disconnect();
    
    this.isRunning = false;
    console.log('HeliusMonitor stopped');
  }

  /**
   * Add a CA to monitoring
   */
  public addCAMonitor(ca: CAMonitor): void {
    this.monitoringService.addCAMonitor(ca);
    
    // Subscribe to price updates if WebSocket is connected
    if (this.wsManager.isConnected()) {
      this.subscribeToCA(ca);
    }
  }

  /**
   * Remove a CA from monitoring
   */
  public removeCAMonitor(chain: string, mint: string): void {
    this.monitoringService.removeCAMonitor(chain, mint);
    
    // Unsubscribe from price updates if WebSocket is connected
    if (this.wsManager.isConnected()) {
      this.unsubscribeFromCA(chain, mint);
    }
  }

  /**
   * Get all active CA monitors
   */
  public getActiveCAs(): Map<string, CAMonitor> {
    return this.monitoringService.getActiveCAs();
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): {
    connected: boolean;
    connecting: boolean;
    reconnectAttempts: number;
    activeCAs: number;
  } {
    const wsStatus = this.wsManager.getStatus();
    return {
      connected: wsStatus.connected,
      connecting: wsStatus.connecting,
      reconnectAttempts: wsStatus.reconnectAttempts,
      activeCAs: this.monitoringService.getActiveCAs().size
    };
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // WebSocket events
    this.wsManager.on('connected', () => {
      console.log('WebSocket connected, subscribing to CA updates');
      this.subscribeToAllCAs();
    });

    this.wsManager.on('disconnected', () => {
      console.log('WebSocket disconnected');
    });

    this.wsManager.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      
      // Handle authentication errors
      if (error.message && error.message.includes('401')) {
        console.log('Helius API key invalid - disabling real-time monitoring');
        this.stop();
      }
    });

    this.wsManager.on('maxReconnectAttemptsReached', () => {
      console.error('Max reconnection attempts reached');
      this.stop();
    });

    this.wsManager.on('message', (message: any) => {
      this.handleWebSocketMessage(message);
    });

    // Monitoring service events
    this.monitoringService.on('alertSent', (event: any) => {
      console.log(`Alert sent for ${event.ca.tokenName}: ${event.type}`);
    });

    this.monitoringService.on('priceUpdated', (event: any) => {
      console.log(`Price updated for ${event.ca.tokenName}: $${event.price}`);
    });
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(message: any): Promise<void> {
    switch (message.method) {
      case 'price-update':
        await this.handlePriceUpdate(message.params);
        break;
      default:
        break;
    }
  }

  /**
   * Handle price update from WebSocket
   */
  private async handlePriceUpdate(params: any): Promise<void> {
    const priceUpdate: PriceUpdateEvent = {
      account: params.account,
      price: params.price,
      marketcap: params.marketcap,
      timestamp: params.timestamp
    };

    await this.monitoringService.handlePriceUpdate(priceUpdate);
  }

  /**
   * Subscribe to all active CAs
   */
  private subscribeToAllCAs(): void {
    const subscriptions = this.monitoringService.getSubscriptionRequests();
    
    subscriptions.forEach(subscription => {
      this.wsManager.subscribe(subscription);
    });

    console.log(`Subscribed to price updates for ${subscriptions.length} assets`);
  }

  /**
   * Subscribe to a specific CA
   */
  private subscribeToCA(ca: CAMonitor): void {
    const subscription = {
      jsonrpc: '2.0',
      id: `${ca.chain}:${ca.mint}`,
      method: 'subscribe',
      params: [
        `price-updates-${ca.chain}`,
        { accounts: [ca.mint] }
      ]
    };

    this.wsManager.subscribe(subscription);
  }

  /**
   * Unsubscribe from a specific CA
   */
  private unsubscribeFromCA(chain: string, mint: string): void {
    const subscriptionId = `${chain}:${mint}`;
    this.wsManager.unsubscribe(subscriptionId);
  }

  /**
   * Schedule hourly performance summaries
   */
  private scheduleHourlySummaries(): void {
    this.summaryTimer = setInterval(async () => {
      try {
        const summary = await this.monitoringService.getPerformanceSummary();
        // Send summary to default chat if configured
        const defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT;
        if (defaultChatId) {
          await this.bot.telegram.sendMessage(defaultChatId, summary, { parse_mode: 'Markdown' });
        }
      } catch (error) {
        console.error('Error sending performance summary:', error);
      }
    }, 3600000); // 1 hour
  }

  /**
   * Start periodic update requests
   */
  private startPeriodicUpdateRequests(): void {
    this.updateTimer = setInterval(() => {
      // Periodic update logic would go here
      console.log('Periodic update check...');
    }, 300000); // 5 minutes
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}
