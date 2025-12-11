"use strict";
/**
 * Event Types
 * ==========
 * Defines all event types used throughout the application.
 * Provides type safety and documentation for event-driven communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_PRIORITIES = exports.EventPriority = exports.EVENT_CATEGORIES = void 0;
// ============================================================================
// Event Categories
// ============================================================================
exports.EVENT_CATEGORIES = {
    USER: ['user.session', 'user.command', 'user.strategy'],
    SIMULATION: ['simulation', 'simulation.run'],
    WEBSOCKET: ['websocket', 'websocket.message', 'websocket.subscription'],
    MONITORING: ['ca.monitor', 'price.update', 'alert', 'ichimoku'],
    SYSTEM: ['system', 'database', 'service'],
    PERFORMANCE: ['performance']
};
// ============================================================================
// Event Priority Levels
// ============================================================================
var EventPriority;
(function (EventPriority) {
    EventPriority[EventPriority["LOW"] = 1] = "LOW";
    EventPriority[EventPriority["NORMAL"] = 2] = "NORMAL";
    EventPriority[EventPriority["HIGH"] = 3] = "HIGH";
    EventPriority[EventPriority["CRITICAL"] = 4] = "CRITICAL";
})(EventPriority || (exports.EventPriority = EventPriority = {}));
exports.EVENT_PRIORITIES = {
    'system.error': EventPriority.CRITICAL,
    'websocket.error': EventPriority.HIGH,
    'alert.stop_loss': EventPriority.HIGH,
    'alert.profit_target': EventPriority.NORMAL,
    'price.update.received': EventPriority.NORMAL,
    'user.command.executed': EventPriority.NORMAL,
    'performance.summary.generated': EventPriority.LOW
};
//# sourceMappingURL=EventTypes.js.map