/**
 * Service Container
 * ================
 * Centralized dependency injection container
 */

import { SessionService } from './SessionService';
import { SimulationService } from './SimulationService';
import { StrategyService } from './StrategyService';
import { CAService } from './CAService';
import { IchimokuService } from './IchimokuService';
import { EventBus } from '../events/EventBus';
import { WebSocketConnectionManager } from '../websocket/WebSocketConnectionManager';
import { WorkflowEngine } from '../commands/WorkflowEngine';

export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();

  private constructor() {
    this.initializeServices();
  }

  public static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  private initializeServices(): void {
    // Core services
    const sessionService = new SessionService();
    const eventBus = new EventBus();
    const webSocketManager = new WebSocketConnectionManager({
      url: 'wss://mainnet.helius-rpc.com',
      apiKey: process.env.HELIUS_API_KEY || '',
      reconnectInterval: 5000,
      maxReconnectAttempts: 10
    });
    
    // Business logic services
    const simulationService = new SimulationService();
    const strategyService = new StrategyService();
    const caService = new CAService();
    const ichimokuService = new IchimokuService();
    
    // Workflow engine
    const workflowEngine = new WorkflowEngine(caService, ichimokuService);

    // Register services
    this.services.set('sessionService', sessionService);
    this.services.set('simulationService', simulationService);
    this.services.set('strategyService', strategyService);
    this.services.set('caService', caService);
    this.services.set('ichimokuService', ichimokuService);
    this.services.set('eventBus', eventBus);
    this.services.set('webSocketManager', webSocketManager);
    this.services.set('workflowEngine', workflowEngine);
  }

  public get<T>(serviceName: string): T {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }
    return service as T;
  }

  public getSessionService(): SessionService {
    return this.get<SessionService>('sessionService');
  }

  public getSimulationService(): SimulationService {
    return this.get<SimulationService>('simulationService');
  }

  public getStrategyService(): StrategyService {
    return this.get<StrategyService>('strategyService');
  }

  public getCAService(): CAService {
    return this.get<CAService>('caService');
  }

  public getIchimokuService(): IchimokuService {
    return this.get<IchimokuService>('ichimokuService');
  }

  public getEventBus(): EventBus {
    return this.get<EventBus>('eventBus');
  }

  public getWebSocketManager(): WebSocketConnectionManager {
    return this.get<WebSocketConnectionManager>('webSocketManager');
  }

  public getWorkflowEngine(): WorkflowEngine {
    return this.get<WorkflowEngine>('workflowEngine');
  }
}
