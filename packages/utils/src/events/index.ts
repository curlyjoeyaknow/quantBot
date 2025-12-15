/**
 * Events Index
 * ============
 * Central export point for the event-driven architecture
 */

export { EventBus, EventFactory, eventBus } from './EventBus';
export type { BaseEvent, EventHandler, EventMiddleware, EventMetadata } from './EventBus';

export * from './EventTypes';
export type { ApplicationEvent } from './EventTypes';

export * from './EventMiddleware';
export {
  MetricsMiddleware,
  RateLimitingMiddleware,
  PerformanceMiddleware,
} from './EventMiddleware';

export * from './EventHandlers';
export { EventHandlerRegistry } from './EventHandlers';
