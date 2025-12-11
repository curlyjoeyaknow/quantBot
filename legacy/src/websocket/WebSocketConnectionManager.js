"use strict";
/**
 * WebSocket Connection Manager
 * ============================
 * Handles WebSocket connections, reconnection logic, and message parsing.
 * Separated from business logic for better modularity and testability.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketConnectionManager = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const events_2 = require("../events");
const logger_1 = require("../utils/logger");
/**
 * WebSocket Connection Manager
 * Manages WebSocket connections with automatic reconnection and message handling
 */
class WebSocketConnectionManager extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.isConnecting = false;
        this.isDestroyed = false;
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
    async connect() {
        if (this.isConnecting || this.isDestroyed) {
            return;
        }
        this.isConnecting = true;
        try {
            logger_1.logger.info('Connecting to WebSocket', { url: this.config.url });
            this.ws = new ws_1.default(this.config.url);
            this.setupEventHandlers();
            this.startHeartbeat();
            // Wait for connection to be established
            await this.waitForConnection();
            logger_1.logger.info('WebSocket connected successfully', { url: this.config.url });
            this.emit('connected');
        }
        catch (error) {
            logger_1.logger.error('Failed to connect to WebSocket', error, { url: this.config.url });
            this.emit('error', error);
            throw error;
        }
        finally {
            this.isConnecting = false;
        }
    }
    /**
     * Disconnect from the WebSocket
     */
    disconnect() {
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
    send(message) {
        if (!this.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        const messageStr = JSON.stringify(message);
        this.ws.send(messageStr);
    }
    /**
     * Subscribe to a specific event
     */
    subscribe(subscription) {
        this.send(subscription);
    }
    /**
     * Unsubscribe from a specific event
     */
    unsubscribe(subscriptionId) {
        const unsubscribeMessage = {
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
    isConnected() {
        return this.ws !== null && this.ws.readyState === ws_1.default.OPEN;
    }
    /**
     * Get connection status
     */
    getStatus() {
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
    setupEventHandlers() {
        if (!this.ws)
            return;
        this.ws.on('open', () => {
            logger_1.logger.debug('WebSocket connection opened', { url: this.config.url });
            this.reconnectAttempts = 0;
            // Emit WebSocket connected event
            events_2.eventBus.publish(events_2.EventFactory.createSystemEvent('websocket.connected', { url: this.config.url }, 'WebSocketConnectionManager'));
            this.emit('open');
        });
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.emit('message', message);
            }
            catch (error) {
                logger_1.logger.error('Error parsing WebSocket message', error);
                this.emit('error', error);
            }
        });
        this.ws.on('close', (code, reason) => {
            logger_1.logger.info('WebSocket connection closed', { code, reason, url: this.config.url });
            // Emit WebSocket disconnected event
            events_2.eventBus.publish(events_2.EventFactory.createSystemEvent('websocket.disconnected', { url: this.config.url }, 'WebSocketConnectionManager'));
            this.emit('close', code, reason);
            if (!this.isDestroyed) {
                this.handleReconnect();
            }
        });
        this.ws.on('error', (error) => {
            logger_1.logger.error('WebSocket error', error, { url: this.config.url });
            // Emit WebSocket error event
            events_2.eventBus.publish(events_2.EventFactory.createSystemEvent('websocket.error', { url: this.config.url, error: error.message }, 'WebSocketConnectionManager'));
            this.emit('error', error);
        });
    }
    /**
     * Handle reconnection logic
     */
    handleReconnect() {
        if (this.isDestroyed || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            logger_1.logger.error('Max reconnection attempts reached or connection destroyed', { url: this.config.url, attempts: this.reconnectAttempts });
            this.emit('maxReconnectAttemptsReached');
            return;
        }
        this.reconnectAttempts++;
        const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        logger_1.logger.info('Reconnecting', { delayMs: delay, attempt: this.reconnectAttempts, maxAttempts: this.config.maxReconnectAttempts, url: this.config.url });
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                logger_1.logger.error('Reconnection failed', error, { url: this.config.url });
            });
        }, delay);
    }
    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
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
    waitForConnection() {
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
                this.ws.off('open', onOpen);
                this.ws.off('error', onError);
                resolve();
            };
            const onError = (error) => {
                clearTimeout(timeout);
                this.ws.off('open', onOpen);
                this.ws.off('error', onError);
                reject(error);
            };
            if (this.ws.readyState === ws_1.default.OPEN) {
                onOpen();
            }
            else {
                this.ws.on('open', onOpen);
                this.ws.on('error', onError);
            }
        });
    }
    /**
     * Clear all timers
     */
    clearTimers() {
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
exports.WebSocketConnectionManager = WebSocketConnectionManager;
//# sourceMappingURL=WebSocketConnectionManager.js.map