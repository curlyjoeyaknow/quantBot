"use strict";
/**
 * Live Trade Strategies Database Functions
 * =======================================
 * Functions to get enabled/disabled strategies for live trade alerts
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnabledStrategies = getEnabledStrategies;
exports.isStrategyEnabled = isStrategyEnabled;
const sqlite3 = __importStar(require("sqlite3"));
const util_1 = require("util");
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Get enabled strategy IDs
 */
async function getEnabledStrategies() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        const all = (0, util_1.promisify)(db.all.bind(db));
        all(`SELECT id FROM live_trade_strategies WHERE enabled = 1`)
            .then((rows) => {
            db.close();
            const enabledSet = new Set(rows.map((r) => r.id));
            resolve(enabledSet);
        })
            .catch((err) => {
            db.close();
            logger_1.logger.error('Failed to get enabled strategies', err);
            // Return default enabled strategies if table doesn't exist
            resolve(new Set(['initial_entry', 'trailing_entry', 'ichimoku_tenkan_kijun']));
        });
    });
}
/**
 * Check if a strategy is enabled
 */
async function isStrategyEnabled(strategyId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        const get = (0, util_1.promisify)(db.get.bind(db));
        get(`SELECT enabled FROM live_trade_strategies WHERE id = ?`, [strategyId])
            .then((row) => {
            db.close();
            // Default to enabled if not found (backward compatibility)
            resolve(row ? row.enabled === 1 : true);
        })
            .catch((err) => {
            db.close();
            logger_1.logger.error('Failed to check strategy enabled status', err);
            // Default to enabled on error
            resolve(true);
        });
    });
}
//# sourceMappingURL=live-trade-strategies.js.map