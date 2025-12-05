"use strict";
/**
 * @quantbot/simulation - Simulation engine package
 *
 * Public API exports for the simulation package
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
// Core engine (includes re-exports of config types)
__exportStar(require("./engine"), exports);
// Supporting modules
__exportStar(require("./candles"), exports);
__exportStar(require("./indicators"), exports);
__exportStar(require("./ichimoku"), exports);
__exportStar(require("./signals"), exports);
__exportStar(require("./sinks"), exports);
__exportStar(require("./target-resolver"), exports);
// Strategies and optimization
__exportStar(require("./strategies"), exports);
__exportStar(require("./optimization"), exports);
//# sourceMappingURL=index.js.map