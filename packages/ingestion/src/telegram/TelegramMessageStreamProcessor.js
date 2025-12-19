"use strict";
/**
 * TelegramMessageStreamProcessor - Process normalized messages to NDJSON streams
 *
 * Writes normalized messages and quarantined messages to separate NDJSON files.
 * This enables debugging and reprocessing without re-parsing exports.
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
exports.TelegramMessageStreamProcessor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("@quantbot/utils");
/**
 * Process normalized and quarantined messages to NDJSON streams
 */
class TelegramMessageStreamProcessor {
    options;
    normalizedPath;
    quarantinePath;
    normalizedStream;
    quarantineStream;
    normalizedCount = 0;
    quarantinedCount = 0;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Initialize output streams
     */
    initialize(baseName) {
        const outputDir = this.options.outputDir || process.cwd();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        if (this.options.writeNormalized !== false) {
            this.normalizedPath = path.join(outputDir, `${baseName}_normalized_messages_${timestamp}.ndjson`);
            this.normalizedStream = fs.createWriteStream(this.normalizedPath, { flags: 'w' });
            utils_1.logger.info('Initialized normalized messages stream', { path: this.normalizedPath });
        }
        if (this.options.writeQuarantine !== false) {
            this.quarantinePath = path.join(outputDir, `${baseName}_quarantine_${timestamp}.ndjson`);
            this.quarantineStream = fs.createWriteStream(this.quarantinePath, { flags: 'w' });
            utils_1.logger.info('Initialized quarantine stream', { path: this.quarantinePath });
        }
    }
    /**
     * Write a normalized message
     */
    writeNormalized(message) {
        if (!this.normalizedStream)
            return;
        const line = JSON.stringify(message) + '\n';
        this.normalizedStream.write(line);
        this.normalizedCount++;
    }
    /**
     * Write a quarantined message with error
     */
    writeQuarantine(error, raw) {
        if (!this.quarantineStream)
            return;
        const record = {
            error: {
                code: error.code,
                message: error.message,
            },
            raw,
            timestamp: new Date().toISOString(),
        };
        const line = JSON.stringify(record) + '\n';
        this.quarantineStream.write(line);
        this.quarantinedCount++;
    }
    /**
     * Write multiple normalized messages
     */
    writeNormalizedBatch(messages) {
        for (const message of messages) {
            this.writeNormalized(message);
        }
    }
    /**
     * Write multiple quarantined messages
     */
    writeQuarantineBatch(quarantined) {
        for (const item of quarantined) {
            this.writeQuarantine(item.error, item.raw);
        }
    }
    /**
     * Close all streams and return results
     */
    async close() {
        const closeStream = (stream) => {
            if (!stream)
                return Promise.resolve();
            return new Promise((resolve, reject) => {
                stream.end((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            });
        };
        await Promise.all([closeStream(this.normalizedStream), closeStream(this.quarantineStream)]);
        const result = {
            normalizedWritten: this.normalizedCount,
            quarantinedWritten: this.quarantinedCount,
            normalizedPath: this.normalizedPath,
            quarantinePath: this.quarantinePath,
        };
        utils_1.logger.info('Closed message streams', {
            normalized: this.normalizedCount,
            quarantined: this.quarantinedCount,
        });
        return result;
    }
    /**
     * Synchronous close (for compatibility)
     */
    closeSync() {
        if (this.normalizedStream) {
            this.normalizedStream.end();
        }
        if (this.quarantineStream) {
            this.quarantineStream.end();
        }
        return {
            normalizedWritten: this.normalizedCount,
            quarantinedWritten: this.quarantinedCount,
            normalizedPath: this.normalizedPath,
            quarantinePath: this.quarantinePath,
        };
    }
    /**
     * Get current statistics
     */
    getStats() {
        return {
            normalized: this.normalizedCount,
            quarantined: this.quarantinedCount,
        };
    }
}
exports.TelegramMessageStreamProcessor = TelegramMessageStreamProcessor;
//# sourceMappingURL=TelegramMessageStreamProcessor.js.map