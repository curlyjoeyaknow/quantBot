"use strict";
/**
 * Events Index
 * ============
 * Central export point for the event-driven architecture
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventHandlerRegistry = exports.PerformanceMiddleware = exports.RateLimitingMiddleware = exports.MetricsMiddleware = exports.eventBus = exports.EventFactory = exports.EventBus = void 0;
var EventBus_1 = require("./EventBus");
Object.defineProperty(exports, "EventBus", { enumerable: true, get: function () { return EventBus_1.EventBus; } });
Object.defineProperty(exports, "EventFactory", { enumerable: true, get: function () { return EventBus_1.EventFactory; } });
Object.defineProperty(exports, "eventBus", { enumerable: true, get: function () { return EventBus_1.eventBus; } });
__exportStar(require("./EventTypes"), exports);
__exportStar(require("./EventMiddleware"), exports);
var EventMiddleware_1 = require("./EventMiddleware");
Object.defineProperty(exports, "MetricsMiddleware", { enumerable: true, get: function () { return EventMiddleware_1.MetricsMiddleware; } });
Object.defineProperty(exports, "RateLimitingMiddleware", { enumerable: true, get: function () { return EventMiddleware_1.RateLimitingMiddleware; } });
Object.defineProperty(exports, "PerformanceMiddleware", { enumerable: true, get: function () { return EventMiddleware_1.PerformanceMiddleware; } });
__exportStar(require("./EventHandlers"), exports);
var EventHandlers_1 = require("./EventHandlers");
Object.defineProperty(exports, "EventHandlerRegistry", { enumerable: true, get: function () { return EventHandlers_1.EventHandlerRegistry; } });
//# sourceMappingURL=index.js.map