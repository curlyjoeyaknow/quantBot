"use strict";
/**
 * Live Trade Database Functions
 * =============================
 * Database functions for storing live trade alerts and price cache
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
exports.storeEntryAlert = storeEntryAlert;
exports.storePriceCache = storePriceCache;
exports.getCachedPrice = getCachedPrice;
exports.getEntryAlertsForToken = getEntryAlertsForToken;
const sqlite3 = __importStar(require("sqlite3"));
const util_1 = require("util");
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Store entry alert in database
 */
async function storeEntryAlert(alert) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        db.run(`INSERT INTO live_trade_entry_alerts 
       (alert_id, token_address, token_symbol, chain, caller_name, alert_price, 
        entry_price, entry_type, signal, price_change, timestamp, sent_to_groups)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            alert.alertId,
            alert.tokenAddress,
            alert.tokenSymbol || null,
            alert.chain,
            alert.callerName,
            alert.alertPrice,
            alert.entryPrice,
            alert.entryType,
            alert.signal,
            alert.priceChange,
            alert.timestamp,
            alert.sentToGroups ? JSON.stringify(alert.sentToGroups) : null,
        ], function (err) {
            db.close();
            if (err) {
                logger_1.logger.error('Failed to store entry alert', err);
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
/**
 * Store price in cache database
 */
async function storePriceCache(tokenAddress, chain, price, marketCap, timestamp) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        const ts = timestamp || Math.floor(Date.now() / 1000);
        db.run(`INSERT OR REPLACE INTO live_trade_price_cache 
       (token_address, chain, price, market_cap, timestamp)
       VALUES (?, ?, ?, ?, ?)`, [tokenAddress, chain, price, marketCap || null, ts], function (err) {
            db.close();
            if (err) {
                logger_1.logger.error('Failed to store price cache', err);
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
/**
 * Get cached price
 */
async function getCachedPrice(tokenAddress, chain, maxAgeSeconds = 30) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        const get = (0, util_1.promisify)(db.get.bind(db));
        get(`SELECT price FROM live_trade_price_cache 
       WHERE token_address = ? AND chain = ? 
       AND timestamp > ? 
       ORDER BY timestamp DESC LIMIT 1`, [tokenAddress, chain, Math.floor(Date.now() / 1000) - maxAgeSeconds])
            .then((row) => {
            db.close();
            resolve(row ? row.price : null);
        })
            .catch((err) => {
            db.close();
            logger_1.logger.error('Failed to get cached price', err);
            reject(err);
        });
    });
}
/**
 * Get entry alerts for a token
 */
async function getEntryAlertsForToken(tokenAddress, limit = 10) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        const all = (0, util_1.promisify)(db.all.bind(db));
        all(`SELECT * FROM live_trade_entry_alerts 
       WHERE token_address = ? 
       ORDER BY timestamp DESC 
       LIMIT ?`, [tokenAddress, limit])
            .then((rows) => {
            db.close();
            resolve(rows);
        })
            .catch((err) => {
            db.close();
            logger_1.logger.error('Failed to get entry alerts', err);
            reject(err);
        });
    });
}
//# sourceMappingURL=live-trade-database.js.map