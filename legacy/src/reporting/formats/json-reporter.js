"use strict";
/**
 * JSON Report Generator
 *
 * Generates JSON format reports from analysis results
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonReporter = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
class JsonReporter {
    /**
     * Generate JSON report from analysis results
     */
    async generate(results, options) {
        const filePath = this.resolvePath(options.path);
        await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
        const data = {
            timestamp: new Date().toISOString(),
            results,
            summary: {
                totalStrategies: results.length,
                bestPerformance: results.length > 0
                    ? results.sort((a, b) => b.pnl.averagePnlPercent - a.pnl.averagePnlPercent)[0]
                    : null,
            },
        };
        const json = JSON.stringify(data, null, options.pretty ? 2 : undefined);
        if (options.append) {
            // For append mode, read existing array and add to it
            try {
                const existing = await fs_1.promises.readFile(filePath, 'utf-8');
                const existingData = JSON.parse(existing);
                if (Array.isArray(existingData)) {
                    existingData.push(data);
                    await fs_1.promises.writeFile(filePath, JSON.stringify(existingData, null, options.pretty ? 2 : undefined), 'utf-8');
                    return filePath;
                }
            }
            catch {
                // File doesn't exist or invalid, create new
            }
        }
        await fs_1.promises.writeFile(filePath, json, 'utf-8');
        return filePath;
    }
    resolvePath(targetPath) {
        return path_1.default.isAbsolute(targetPath) ? targetPath : path_1.default.join(process.cwd(), targetPath);
    }
}
exports.JsonReporter = JsonReporter;
//# sourceMappingURL=json-reporter.js.map