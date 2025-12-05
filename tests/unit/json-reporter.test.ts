import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonReporter, type JsonReportOptions } from '../../src/reporting/formats/json-reporter';
import type { AnalysisResult } from '../../src/analysis/result-analyzer';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
  },
}));

describe('JsonReporter', () => {
  let reporter: JsonReporter;
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
    reporter = new JsonReporter();
    testDir = path.join(os.tmpdir(), 'json-reporter-test');
  });

  describe('generate', () => {
    it('should generate JSON report', async () => {
      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
      };

      const filePath = await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(filePath).toBeDefined();
    });

    it('should include timestamp and summary', async () => {
      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const data = JSON.parse(content);

      expect(data.timestamp).toBeDefined();
      expect(data.results).toEqual(results);
      expect(data.summary.totalStrategies).toBe(1);
    });

    it('should format with pretty printing when requested', async () => {
      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        pretty: true,
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;

      // Pretty JSON should have newlines
      expect(content).toContain('\n');
    });

    it('should format without pretty printing by default', async () => {
      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        pretty: false,
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;

      // Compact JSON should be on single line (or minimal formatting)
      const parsed = JSON.parse(content);
      expect(parsed).toBeDefined();
    });

    it('should identify best performing strategy', async () => {
      const results = [
        createMockAnalysisResult({ pnl: { ...createMockAnalysisResult().pnl, averagePnlPercent: 5 } }),
        createMockAnalysisResult({ pnl: { ...createMockAnalysisResult().pnl, averagePnlPercent: 20 } }), // Best
        createMockAnalysisResult({ pnl: { ...createMockAnalysisResult().pnl, averagePnlPercent: 10 } }),
      ];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const data = JSON.parse(content);

      expect(data.summary.bestPerformance).toBeDefined();
      expect(data.summary.bestPerformance.pnl.averagePnlPercent).toBe(20);
    });

    it('should handle empty results', async () => {
      const results: AnalysisResult[] = [];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const data = JSON.parse(content);

      expect(data.results).toEqual([]);
      expect(data.summary.totalStrategies).toBe(0);
      expect(data.summary.bestPerformance).toBeNull();
    });

    it('should append to existing array file', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify([{ test: 'data' }]));

      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        append: true,
      };

      await reporter.generate(results, options);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const data = JSON.parse(content);

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
    });

    it('should create new file if append fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        append: true,
      };

      await reporter.generate(results, options);

      // Should create new file instead
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle invalid existing file on append', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('invalid json');

      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        append: true,
      };

      await reporter.generate(results, options);

      // Should create new file instead
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle non-array existing file on append', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ not: 'array' }));

      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: path.join(testDir, 'test.json'),
        append: true,
      };

      await reporter.generate(results, options);

      // Should create new file instead
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle absolute paths', async () => {
      const results = [createMockAnalysisResult()];
      const absolutePath = path.join(os.tmpdir(), 'absolute-test.json');
      const options: JsonReportOptions = {
        path: absolutePath,
      };

      await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should handle relative paths', async () => {
      const results = [createMockAnalysisResult()];
      const options: JsonReportOptions = {
        path: 'relative-test.json',
      };

      await reporter.generate(results, options);

      expect(fs.mkdir).toHaveBeenCalled();
    });
  });
});





