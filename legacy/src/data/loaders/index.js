"use strict";
/**
 * Data Loader Factory
 *
 * Provides access to all data loaders and factory methods
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
exports.getLoader = getLoader;
exports.loadData = loadData;
exports.registerLoader = registerLoader;
const csv_loader_1 = require("./csv-loader");
// Export types
__exportStar(require("./types"), exports);
const clickhouse_loader_1 = require("./clickhouse-loader");
const caller_loader_1 = require("./caller-loader");
// Available loaders
const loaders = [
    new csv_loader_1.CsvDataLoader(),
    new clickhouse_loader_1.ClickHouseDataLoader(),
    new caller_loader_1.CallerDataLoader(),
];
/**
 * Get a loader that can handle the given source
 */
function getLoader(source) {
    return loaders.find(loader => loader.canLoad(source)) || null;
}
/**
 * Load data using the appropriate loader
 */
async function loadData(params) {
    const loader = getLoader(params.source);
    if (!loader) {
        throw new Error(`No loader found for source: ${params.source}`);
    }
    return loader.load(params);
}
/**
 * Register a new loader
 */
function registerLoader(loader) {
    loaders.push(loader);
}
//# sourceMappingURL=index.js.map