"use strict";
/**
 * CSV Report Generator
 *
 * Generates CSV format reports from analysis results
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvReporter = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const csv_stringify_1 = require("csv-stringify");
class CsvReporter {
    constructor() {
        this.initializedFiles = new Set();
    }
    /**
     * Generate CSV report from analysis results
     */
    async generate(results, options) {
        const filePath = this.resolvePath(options.path);
        await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
        const isNewFile = !this.initializedFiles.has(filePath) || !options.append;
        if (isNewFile) {
            // Write header
            const header = this.getHeader(options.includeDetails);
            await fs_1.promises.writeFile(filePath, header, 'utf-8');
            this.initializedFiles.add(filePath);
        }
        // Convert results to CSV rows
        const rows = results.map(result => this.resultToRow(result, options.includeDetails));
        // Write rows
        return new Promise((resolve, reject) => {
            (0, csv_stringify_1.stringify)(rows, { header: false }, async (err, output) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    await fs_1.promises.appendFile(filePath, output, 'utf-8');
                    resolve(filePath);
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    getHeader(includeDetails) {
        const baseColumns = [
            'Strategy',
            'Total Trades',
            'Win Rate %',
            'Avg PnL %',
            'Total PnL %',
            'Profit Factor',
            'Sharpe Ratio',
            'Max Drawdown %',
        ];
        if (includeDetails) {
            return [
                ...baseColumns,
                'Avg Win',
                'Avg Loss',
                'Largest Win',
                'Largest Loss',
                'Expectancy',
                'Sortino Ratio',
                'Calmar Ratio',
            ].join(',') + '\n';
        }
        return baseColumns.join(',') + '\n';
    }
    resultToRow(result, includeDetails) {
        const base = {
            'Strategy': result.summary.totalResults.toString(),
            'Total Trades': result.trade.totalTrades.toString(),
            'Win Rate %': result.trade.winRate.toFixed(2),
            'Avg PnL %': result.pnl.averagePnlPercent.toFixed(2),
            'Total PnL %': result.pnl.totalPnlPercent.toFixed(2),
            'Profit Factor': result.trade.profitFactor.toFixed(2),
            'Sharpe Ratio': result.risk.sharpeRatio.toFixed(2),
            'Max Drawdown %': result.risk.maxDrawdownPercent.toFixed(2),
        };
        if (includeDetails) {
            return {
                ...base,
                'Avg Win': result.trade.avgWin.toFixed(4),
                'Avg Loss': result.trade.avgLoss.toFixed(4),
                'Largest Win': result.trade.largestWin.toFixed(4),
                'Largest Loss': result.trade.largestLoss.toFixed(4),
                'Expectancy': result.trade.expectancy.toFixed(4),
                'Sortino Ratio': result.risk.sortinoRatio.toFixed(2),
                'Calmar Ratio': result.risk.calmarRatio.toFixed(2),
            };
        }
        return base;
    }
    resolvePath(targetPath) {
        return path_1.default.isAbsolute(targetPath) ? targetPath : path_1.default.join(process.cwd(), targetPath);
    }
}
exports.CsvReporter = CsvReporter;
//# sourceMappingURL=csv-reporter.js.map