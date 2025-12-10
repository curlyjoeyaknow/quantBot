"use strict";
/**
 * Simulation Service
 * ==================
 * Manages simulation run operations including saving and retrieving simulation results.
 * Coordinates between the simulation engine and data persistence.
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
exports.simulationService = exports.SimulationService = void 0;
const luxon_1 = require("luxon");
const simulate_1 = require("../simulate");
const candles_1 = require("../simulation/candles");
const db = __importStar(require("../utils/database"));
const events_1 = require("../events");
/**
 * Service for managing simulation operations
 */
class SimulationService {
    /**
     * Run a simulation with the given parameters
     */
    async runSimulation(params) {
        const { mint, chain, startTime, endTime, strategy, stopLossConfig, userId } = params;
        // Emit simulation started event
        await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('simulation.started', { mint, chain, strategy }, 'SimulationService', userId));
        try {
            // Fetch candles for the simulation period
            const endDateTime = endTime || luxon_1.DateTime.utc();
            const candles = await (0, candles_1.fetchHybridCandles)(mint, startTime, endDateTime, chain);
            if (candles.length === 0) {
                throw new Error('No candle data available for simulation period');
            }
            // Run the simulation
            const result = (0, simulate_1.simulateStrategy)(candles, strategy, stopLossConfig);
            // Emit simulation completed event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('simulation.completed', { mint, chain, strategy, result }, 'SimulationService', userId));
            return result;
        }
        catch (error) {
            // Emit simulation failed event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('simulation.failed', { mint, chain, strategy, error: error instanceof Error ? error.message : String(error) }, 'SimulationService', userId));
            throw error;
        }
    }
    /**
     * Save a simulation run to the database
     */
    async saveSimulationRun(params) {
        return db.saveSimulationRun(params);
    }
    /**
     * Get simulation runs for a user
     */
    async getUserSimulationRuns(userId, limit = 10) {
        return db.getUserSimulationRuns(userId, limit);
    }
    /**
     * Get a specific simulation run by ID
     */
    async getSimulationRun(runId) {
        return db.getSimulationRun(runId);
    }
    /**
     * Run a complete simulation and save the results
     */
    async runAndSaveSimulation(params) {
        const result = await this.runSimulation(params);
        const runId = await this.saveSimulationRun({
            userId: params.userId,
            mint: params.mint,
            chain: params.chain,
            startTime: params.startTime,
            endTime: params.endTime || luxon_1.DateTime.utc(),
            strategy: params.strategy,
            stopLossConfig: params.stopLossConfig,
            finalPnl: result.finalPnl,
            totalCandles: result.totalCandles,
            events: result.events,
        });
        return { ...result, runId };
    }
    /**
     * Repeat a previous simulation with the same parameters
     */
    async repeatSimulation(userId, runIdOrIndex) {
        // If it's a small number, treat it as an index
        if (runIdOrIndex < 100) {
            const runs = await this.getUserSimulationRuns(userId, 100);
            const run = runs[runIdOrIndex - 1];
            if (!run) {
                throw new Error(`No simulation run found at index ${runIdOrIndex}`);
            }
            return this.runSimulation({
                userId,
                mint: run.mint,
                chain: run.chain,
                startTime: run.startTime,
                endTime: run.endTime,
                strategy: run.strategy,
                stopLossConfig: run.stopLossConfig,
            });
        }
        else {
            // Treat it as a run ID
            const run = await this.getSimulationRun(runIdOrIndex);
            if (!run) {
                throw new Error(`Simulation run ${runIdOrIndex} not found`);
            }
            return this.runSimulation({
                userId,
                mint: run.mint,
                chain: run.chain,
                startTime: run.startTime,
                endTime: run.endTime,
                strategy: run.strategy,
                stopLossConfig: run.stopLossConfig,
            });
        }
    }
}
exports.SimulationService = SimulationService;
// Export singleton instance
exports.simulationService = new SimulationService();
//# sourceMappingURL=SimulationService.js.map