/**
 * WebSocket Connection Manager
 * ============================
 * Handles WebSocket connections, reconnection logic, and message parsing.
 * Separated from business logic for better modularity and testability.
 */
import { EventEmitter } from 'events';
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
export declare class WebSocketConnectionManager extends EventEmitter {
    private ws;
    private config;
    private reconnectAttempts;
    private reconnectTimer;
    private heartbeatTimer;
    private isConnecting;
    private isDestroyed;
    constructor(config: WebSocketConfig);
    /**
     * Connect to the WebSocket
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the WebSocket
     */
    disconnect(): void;
    /**
     * Send a message through the WebSocket
     */
    send(message: WebSocketMessage | WebSocketSubscription): void;
    /**
     * Subscribe to a specific event
     */
    subscribe(subscription: WebSocketSubscription): void;
    /**
     * Unsubscribe from a specific event
     */
    unsubscribe(subscriptionId: string): void;
    /**
     * Check if WebSocket is connected
     */
    isConnected(): boolean;
    /**
     * Get connection status
     */
    getStatus(): {
        connected: boolean;
        connecting: boolean;
        reconnectAttempts: number;
        url: string;
    };
    /**
     * Setup WebSocket event handlers
     */
    private setupEventHandlers;
    /**
     * Handle reconnection logic
     */
    private handleReconnect;
    /**
     * Start heartbeat to keep connection alive
     */
    private startHeartbeat;
    /**
     * Wait for connection to be established
     */
    private waitForConnection;
    /**
     * Clear all timers
     */
    private clearTimers;
}
//# sourceMappingURL=WebSocketConnectionManager.d.ts.map