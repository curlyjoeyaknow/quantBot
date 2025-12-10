"use strict";
/**
 * Configuration Management
 * ========================
 * Centralized configuration with validation and type safety.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfigInstance = void 0;
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
exports.getConfigValue = getConfigValue;
exports.resetConfig = resetConfig;
exports.validateConfigKey = validateConfigKey;
require("dotenv/config");
const schema_1 = require("./schema");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
let config = null;
/**
 * Load and validate configuration
 */
function loadConfig() {
    if (config) {
        return config;
    }
    try {
        // Parse and validate environment variables
        const result = schema_1.envSchema.safeParse(process.env);
        if (!result.success) {
            const errors = result.error.issues.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ');
            throw new errors_1.ConfigurationError(`Configuration validation failed: ${errors}`, undefined, { errors: result.error.issues });
        }
        config = result.data;
        // Use TELEGRAM_BOT_TOKEN as fallback for BOT_TOKEN if not set
        if (!config.BOT_TOKEN && config.TELEGRAM_BOT_TOKEN) {
            config.BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
        }
        logger_1.logger.info('Configuration loaded successfully', {
            nodeEnv: config.NODE_ENV,
            logLevel: config.LOG_LEVEL,
        });
        return config;
    }
    catch (error) {
        if (error instanceof errors_1.ConfigurationError) {
            throw error;
        }
        throw new errors_1.ConfigurationError(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Get configuration (loads if not already loaded)
 */
function getConfig() {
    return loadConfig();
}
/**
 * Get a specific configuration value
 */
function getConfigValue(key) {
    const cfg = getConfig();
    return cfg[key];
}
/**
 * Reset configuration (useful for testing)
 */
function resetConfig() {
    config = null;
}
/**
 * Validate a specific configuration key
 */
function validateConfigKey(key, value) {
    try {
        const schema = schema_1.envSchema.shape[key];
        if (!schema) {
            return false;
        }
        schema.parse(value);
        return true;
    }
    catch {
        return false;
    }
}
// Export configuration getter function (lazy load to avoid issues)
const getConfigInstance = () => {
    return getConfig();
};
exports.getConfigInstance = getConfigInstance;
//# sourceMappingURL=index.js.map