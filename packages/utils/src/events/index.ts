/**
 * Events Index
 * ============
 * Central export point for the event-driven architecture
 */

export { EventBus, EventFactory, eventBus } from './EventBus.js';
export type { BaseEvent, EventHandler, EventMiddleware, EventMetadata } from './EventBus.js';

export * from './EventTypes.js';
export type { ApplicationEvent } from './EventTypes.js';

export * from './EventMiddleware.js';
export {
  MetricsMiddleware,
  RateLimitingMiddleware,
  PerformanceMiddleware,
} from './EventMiddleware.js';

export * from './EventHandlers.js';
export { EventHandlerRegistry } from './EventHandlers.js';
