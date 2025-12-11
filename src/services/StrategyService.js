"use strict";
/**
 * Strategy Service
 * ================
 * Manages trading strategy operations including CRUD operations.
 * Wraps database operations with a clean service interface.
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
exports.strategyService = exports.StrategyService = void 0;
const db = __importStar(require("../utils/database"));
/**
 * Service for managing trading strategies
 */
class StrategyService {
    /**
     * Save a new strategy or update an existing one
     */
    async saveStrategy(userId, strategyData) {
        return db.saveStrategy({
            userId,
            ...strategyData,
        });
    }
    /**
     * Get all strategies for a user
     */
    async getUserStrategies(userId) {
        return db.getUserStrategies(userId);
    }
    /**
     * Get a specific strategy by name for a user
     */
    async getStrategy(userId, name) {
        return db.getStrategy(userId, name);
    }
    /**
     * Delete a strategy
     */
    async deleteStrategy(userId, name) {
        return db.deleteStrategy(userId, name);
    }
    /**
     * Check if a strategy exists for a user
     */
    async strategyExists(userId, name) {
        const strategy = await this.getStrategy(userId, name);
        return strategy !== null;
    }
    /**
     * Get default strategy for a user
     */
    async getDefaultStrategy(userId) {
        const strategies = await this.getUserStrategies(userId);
        return strategies.find(s => s.isDefault) || null;
    }
    /**
     * Set a strategy as default
     */
    async setDefaultStrategy(userId, name) {
        // First, unset all defaults for this user
        const strategies = await this.getUserStrategies(userId);
        for (const strategy of strategies) {
            if (strategy.isDefault) {
                await this.saveStrategy(userId, {
                    name: strategy.name,
                    description: strategy.description,
                    strategy: strategy.strategy,
                    stopLossConfig: strategy.stopLossConfig,
                    isDefault: false,
                });
            }
        }
        // Then set the new default
        const strategy = await this.getStrategy(userId, name);
        if (!strategy) {
            throw new Error(`Strategy "${name}" not found`);
        }
        await this.saveStrategy(userId, {
            name: strategy.name,
            description: strategy.description,
            strategy: strategy.strategy,
            stopLossConfig: strategy.stopLossConfig,
            isDefault: true,
        });
    }
}
exports.StrategyService = StrategyService;
// Export singleton instance
exports.strategyService = new StrategyService();
//# sourceMappingURL=StrategyService.js.map