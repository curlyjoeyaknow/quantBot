/**
 * @quantbot/services - Business logic services package
 * 
 * Public API exports for the services package
 * 
 * NOTE: This package is being deprecated in favor of modular packages.
 * Many exports are re-exported from new packages for backward compatibility.
 * New code should import directly from the new packages:
 * - @quantbot/api-clients (API clients)
 * - @quantbot/events (Event bus)
 * - @quantbot/token-analysis (Token analysis)
 * - @quantbot/ohlcv (OHLCV services)
 * - @quantbot/ingestion (Ingestion services)
 * - @quantbot/workflows (Workflow services)
 */

// Core services that remain in this package
export { SessionService, sessionService } from './SessionService';
export { SimulationService, simulationService } from './SimulationService';
export { StrategyService, strategyService } from './StrategyService';
export * from './interfaces/ServiceInterfaces';

// Re-export from new modular packages for backward compatibility
export * from '@quantbot/workflows';
export * from '@quantbot/token-analysis';
export * from '@quantbot/ohlcv';
export * from '@quantbot/ingestion';
export * from '@quantbot/api-clients';

// Package logger
export { logger } from './logger';
