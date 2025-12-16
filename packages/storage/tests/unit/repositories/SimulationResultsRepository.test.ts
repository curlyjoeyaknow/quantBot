import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationResultsRepository } from '../../../src/postgres/repositories/SimulationResultsRepository';
import { getPostgresPool } from '../../../src/postgres/postgres-client';

vi.mock('../../../src/postgres/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('SimulationResultsRepository', () => {
  let repository: SimulationResultsRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new SimulationResultsRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('upsertSummary', () => {
    it('should upsert simulation results summary', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.upsertSummary({
        simulationRunId: 1,
        finalPnl: 100.5,
        maxDrawdown: 10.0,
        volatility: 0.15,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        winRate: 0.6,
        tradeCount: 10,
        avgTradeReturn: 10.0,
        medianTradeReturn: 8.0,
        reentryCount: 2,
        ladderEntriesUsed: 3,
        ladderExitsUsed: 2,
        averageHoldingMinutes: 60,
        maxHoldingMinutes: 120,
        metadata: { key: 'value' },
      });

      expect(mockPool.query).toHaveBeenCalled();
      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('INSERT');
      expect(query).toContain('ON CONFLICT');
    });

    it('should handle minimal data', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.upsertSummary({
        simulationRunId: 1,
        finalPnl: 50.0,
      });

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('findByRunId', () => {
    it('should find results by run ID', async () => {
      const mockResult = {
        id: 1,
        simulation_run_id: 1,
        final_pnl: 100.5,
        max_drawdown: 10.0,
        volatility: 0.15,
        sharpe_ratio: 1.5,
        sortino_ratio: 2.0,
        win_rate: 0.6,
        trade_count: 10,
        avg_trade_return: 10.0,
        median_trade_return: 8.0,
        reentry_count: 2,
        ladder_entries_used: 3,
        ladder_exits_used: 2,
        average_holding_minutes: 60,
        max_holding_minutes: 120,
        metadata_json: { key: 'value' },
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPool.query.mockResolvedValue({ rows: [mockResult] });

      const result = await repository.findByRunId(1);

      expect(result).toBeDefined();
      expect(result?.finalPnl).toBe(100.5);
    });

    it('should return null if results not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.findByRunId(999);

      expect(result).toBeNull();
    });
  });
});
