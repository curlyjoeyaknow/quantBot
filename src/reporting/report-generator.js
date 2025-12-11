"use strict";
/**
 * Report Generator
 *
 * Main class for generating reports in various formats
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportGenerator = void 0;
const csv_reporter_1 = require("./formats/csv-reporter");
const json_reporter_1 = require("./formats/json-reporter");
class ReportGenerator {
    constructor() {
        this.csvReporter = new csv_reporter_1.CsvReporter();
        this.jsonReporter = new json_reporter_1.JsonReporter();
    }
    /**
     * Generate a report from analysis results
     */
    async generate(results, options) {
        switch (options.format) {
            case 'csv':
                return this.csvReporter.generate(results, options);
            case 'json':
                return this.jsonReporter.generate(results, options);
            case 'html':
                throw new Error('HTML reporter not yet implemented');
            case 'markdown':
                throw new Error('Markdown reporter not yet implemented');
            default:
                throw new Error(`Unsupported report format: ${options.format}`);
        }
    }
    /**
     * Check if a format is supported
     */
    supports(format) {
        return ['csv', 'json'].includes(format);
    }
}
exports.ReportGenerator = ReportGenerator;
//# sourceMappingURL=report-generator.js.map