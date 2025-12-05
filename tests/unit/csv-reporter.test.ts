import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsvReporter, type CsvReportOptions } from '../../src/reporting/formats/csv-reporter';
import type { AnalysisResult } from '../../src/analysis/result-analyzer';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock csv-stringify
const mockStringify = vi.fn((rows, options, callback) => {
  const output = rows.map((row: any) => Object.values(row).join(',')).join('\n') + '\n';
  callback(null, output);
});

vi.mock('csv-stringify', () => ({
  stringify: mockStringify,
}));

describe('CsvReporter', () => {
  let reporter: CsvReporter;
  let testDir: string;

  const createMockAnalysisResult = (overrides?: Partial<AnalysisResult>): AnalysisResult => ({
    pnl: {
      totalPnl: 100,
      totalPnlPercent: 10,
      averagePnl: 1.1,
      averagePnlPercent: 10,
      medianPnl: 1.1,
      bestTrade: 2.0,
      worstTrade: 0.5,
      profitableTrades: 5,
      losingTrades: 3,
      breakEvenTrades: 2,
    },
    risk: {
      sharpeRatio: 1.5,
      maxDrawdown: 0.1,
      maxDrawdownPercent: 10,
      volatility: 0.2,
      downsideDeviation: 0.15,
      sortinoRatio: 2.0,
      calmarRatio: 1.0,
    },
    trade: {
      totalTrades: 10,
      winningTrades: 5,
      losingTrades: 3,
      breakEvenTrades: 2,
      winRate: 50,
      lossRate: 30,
      avgWin: 0.2,
      avgLoss: 0.1,
      largestWin: 0.5,
      largestLoss: 0.2,
      profitFactor: 2.0,
      expectancy: 0.05,
      avgHoldDuration: 60,
      avgTimeToAth: 30,
    },
    summary: {
      totalResults: 10,
      overallPerformance: 'good',
      recommendation: 'Strategy looks good',
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new CsvReporter();
    testDir = path.join(os.tmpdir(), 'csv-reporter-test');
  });

  describe('generate', () => {
    it('should generate CSV report with basic columns', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
      };

      await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(mockStringify).toHaveBeenCalled();
    });

    it('should include header for new file', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[1]).toContain('Strategy');
      expect(writeCall[1]).toContain('Total Trades');
      expect(writeCall[1]).toContain('Win Rate %');
    });

    it('should include details columns when requested', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
        includeDetails: true,
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[1]).toContain('Avg Win');
      expect(writeCall[1]).toContain('Avg Loss');
      expect(writeCall[1]).toContain('Sortino Ratio');
    });

    it('should append to existing file', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
        append: true,
      };

      // First write
      await reporter.generate(results, options);
      vi.clearAllMocks();

      // Second write (append)
      await reporter.generate(results, options);

      expect(fs.appendFile).toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle multiple results', async () => {
      const results = [
        createMockAnalysisResult(),
        createMockAnalysisResult({ summary: { totalResults: 20, overallPerformance: 'excellent', recommendation: 'Great strategy' } }),
      ];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
      };

      await reporter.generate(results, options);

      expect(mockStringify).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ 'Total Trades': '10' }),
          expect.objectContaining({ 'Total Trades': '10' }),
        ]),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle absolute paths', async () => {
      const results = [createMockAnalysisResult()];
      const absolutePath = path.join(os.tmpdir(), 'absolute-test.csv');
      const options: CsvReportOptions = {
        path: absolutePath,
      };

      await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should handle relative paths', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: 'relative-test.csv',
      };

      await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should format numeric values correctly', async () => {
      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
      };

      await reporter.generate(results, options);

      const stringifyCall = mockStringify.mock.calls[0];
      const rows = stringifyCall[0] as any[];
      expect(rows[0]['Win Rate %']).toBe('50.00');
      expect(rows[0]['Avg PnL %']).toBe('10.00');
    });

    it('should handle csv-stringify errors', async () => {
      mockStringify.mockImplementationOnce((rows, options, callback) => {
        callback(new Error('CSV generation failed'), null);
      });

      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
      };

      await expect(reporter.generate(results, options)).rejects.toThrow();
    });

    it('should handle file write errors', async () => {
      vi.mocked(fs.appendFile).mockRejectedValueOnce(new Error('Write failed'));

      mockStringify.mockImplementationOnce((rows, options, callback) => {
        callback(null, 'test,data\n');
      });

      const results = [createMockAnalysisResult()];
      const options: CsvReportOptions = {
        path: path.join(testDir, 'test.csv'),
        append: true,
      };

      await expect(reporter.generate(results, options)).rejects.toThrow();
    });
  });
});





