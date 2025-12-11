/**
 * WebSocket Connection Manager
 * ============================
 * Handles WebSocket connections, reconnection logic, and message parsing.
 * Separated from business logic for better modularity and testability.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { eventBus, EventFactory } from '../events';
import { logger } from '../utils/logger';

export interface WebSocketConfig {
  url: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

export interface WebSocketMessage {
  method: string;
  params?: any;
  id?: string;
  jsonrpc?: string;
}

export interface WebSocketSubscription {
  method: string;
  params: any[];
  id: string;
}

/**
 * WebSocket Connection Manager
 * Manages WebSocket connections with automatic reconnection and message handling
 */
export class WebSocketConnectionManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private isDestroyed: boolean = false;

  constructor(config: WebSocketConfig) {
    super();
    this.config = {
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      ...config
    };
  }

  /**
   * Connect to the WebSocket
   */
  public async connect(): Promise<void> {
    if (this.isConnecting || this.isDestroyed) {
      return;
    }

    this.isConnecting = true;

    try {
      logger.info('Connecting to WebSocket', { url: this.config.url });
      this.ws = new WebSocket(this.config.url);

      this.setupEventHandlers();
      this.startHeartbeat();

      // Wait for connection to be established
      await this.waitForConnection();
      
      logger.info('WebSocket connected successfully', { url: this.config.url });
      this.emit('connected');
    } catch (error) {
      logger.error('Failed to connect to WebSocket', error as Error, { url: this.config.url });
      this.emit('error', error);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from the WebSocket
   */
  public disconnect(): void {
    this.isDestroyed = true;
    this.clearTimers();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.emit('disconnected');
  }

  /**
   * Send a message through the WebSocket
   */
  public send(message: WebSocketMessage | WebSocketSubscription): void {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    const messageStr = JSON.stringify(message);
    this.ws!.send(messageStr);
  }

  /**
   * Subscribe to a specific event
   */
  public subscribe(subscription: WebSocketSubscription): void {
    this.send(subscription);
  }

  /**
   * Unsubscribe from a specific event
   */
  public unsubscribe(subscriptionId: string): void {
    const unsubscribeMessage: WebSocketMessage = {
      jsonrpc: '2.0',
      id: subscriptionId,
      method: 'unsubscribe',
      params: [subscriptionId]
    };
    this.send(unsubscribeMessage);
  }

  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection status
   */
  public getStatus(): {
    connected: boolean;
    connecting: boolean;
    reconnectAttempts: number;
    url: string;
  } {
    return {
      connected: this.isConnected(),
      connecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
      url: this.config.url
    };
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      logger.debug('WebSocket connection opened', { url: this.config.url });
      this.reconnectAttempts = 0;
      
      // Emit WebSocket connected event
      eventBus.publish(EventFactory.createSystemEvent(
        'websocket.connected',
        { url: this.config.url },
        'WebSocketConnectionManager'
      ));
      
      this.emit('open');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.emit('message', message);
      } catch (error) {
        logger.error('Error parsing WebSocket message', error as Error);
        this.emit('error', error);
      }
    });

    this.ws.on('close', (code: number, reason: string) => {
      logger.info('WebSocket connection closed', { code, reason, url: this.config.url });
      
      // Emit WebSocket disconnected event
      eventBus.publish(EventFactory.createSystemEvent(
        'websocket.disconnected',
        { url: this.config.url },
        'WebSocketConnectionManager'
      ));
      
      this.emit('close', code, reason);
      
      if (!this.isDestroyed) {
        this.handleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      logger.error('WebSocket error', error as Error, { url: this.config.url });
      
      // Emit WebSocket error event
      eventBus.publish(EventFactory.createSystemEvent(
        'websocket.error',
        { url: this.config.url, error: error.message },
        'WebSocketConnectionManager'
      ));
      
      this.emit('error', error);
    });
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.isDestroyed || this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      logger.error('Max reconnection attempts reached or connection destroyed', { url: this.config.url, attempts: this.reconnectAttempts });
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay! * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info('Reconnecting', { delayMs: delay, attempt: this.reconnectAttempts, maxAttempts: this.config.maxReconnectAttempts, url: this.config.url });
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        logger.error('Reconnection failed', error as Error, { url: this.config.url });
      });
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        // Send ping to keep connection alive
        this.send({ method: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Wait for connection to be established
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      const onOpen = () => {
        clearTimeout(timeout);
        this.ws!.off('open', onOpen);
        this.ws!.off('error', onError);
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        this.ws!.off('open', onOpen);
        this.ws!.off('error', onError);
        reject(error);
      };

      if (this.ws.readyState === WebSocket.OPEN) {
        onOpen();
      } else {
        this.ws.on('open', onOpen);
        this.ws.on('error', onError);
      }
    });
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
