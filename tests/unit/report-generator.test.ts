import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReportOptions } from '../../src/reporting/report-generator';
import type { AnalysisResult } from '../../src/analysis/result-analyzer';

const mockCsvGenerate = vi.fn().mockResolvedValue('/path/to/report.csv');
const mockJsonGenerate = vi.fn().mockResolvedValue('/path/to/report.json');

// Mock reporters - need to return a class constructor
vi.mock('../../src/reporting/formats/csv-reporter', () => {
  class MockCsvReporter {
    generate = mockCsvGenerate;
  }
  return {
    CsvReporter: MockCsvReporter,
  };
});

vi.mock('../../src/reporting/formats/json-reporter', () => {
  class MockJsonReporter {
    generate = mockJsonGenerate;
  }
  return {
    JsonReporter: MockJsonReporter,
  };
});

// Import after mocks are set up
import { ReportGenerator } from '../../src/reporting/report-generator';

describe('ReportGenerator', () => {
  let generator: ReportGenerator;
  const mockResults: AnalysisResult[] = [
    {
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
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCsvGenerate.mockClear();
    mockJsonGenerate.mockClear();
    generator = new ReportGenerator();
  });

  describe('generate', () => {
    it('should generate CSV report', async () => {
      const options: ReportOptions = {
        format: 'csv',
        output: '/path/to/report.csv',
      };

      const result = await generator.generate(mockResults, options);

      expect(result).toBe('/path/to/report.csv');
      expect(mockCsvGenerate).toHaveBeenCalledWith(mockResults, options);
    });

    it('should generate JSON report', async () => {
      const options: ReportOptions = {
        format: 'json',
        output: '/path/to/report.json',
        pretty: true,
      };

      const result = await generator.generate(mockResults, options);

      expect(result).toBe('/path/to/report.json');
      expect(mockJsonGenerate).toHaveBeenCalledWith(mockResults, options);
    });

    it('should throw error for unsupported HTML format', async () => {
      const options: ReportOptions = {
        format: 'html',
        output: '/path/to/report.html',
      };

      await expect(generator.generate(mockResults, options)).rejects.toThrow(
        'HTML reporter not yet implemented'
      );
    });

    it('should throw error for unsupported markdown format', async () => {
      const options: ReportOptions = {
        format: 'markdown',
        output: '/path/to/report.md',
      };

      await expect(generator.generate(mockResults, options)).rejects.toThrow(
        'Markdown reporter not yet implemented'
      );
    });

    it('should throw error for unknown format', async () => {
      const options: ReportOptions = {
        format: 'unknown' as any,
        output: '/path/to/report.txt',
      };

      await expect(generator.generate(mockResults, options)).rejects.toThrow(
        'Unsupported report format'
      );
    });

    it('should pass through additional options to CSV reporter', async () => {
      const options: ReportOptions = {
        format: 'csv',
        output: '/path/to/report.csv',
        append: true,
        includeDetails: true,
      };

      await generator.generate(mockResults, options);

      expect(mockCsvGenerate).toHaveBeenCalledWith(mockResults, options);
    });

    it('should pass through additional options to JSON reporter', async () => {
      const options: ReportOptions = {
        format: 'json',
        output: '/path/to/report.json',
        pretty: true,
        append: false,
      };

      await generator.generate(mockResults, options);

      expect(mockJsonGenerate).toHaveBeenCalledWith(mockResults, options);
    });
  });

  describe('supports', () => {
    it('should return true for CSV format', () => {
      expect(generator.supports('csv')).toBe(true);
    });

    it('should return true for JSON format', () => {
      expect(generator.supports('json')).toBe(true);
    });

    it('should return false for HTML format', () => {
      expect(generator.supports('html')).toBe(false);
    });

    it('should return false for markdown format', () => {
      expect(generator.supports('markdown')).toBe(false);
    });
  });
});

