import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { SimulationRunsRepository } from '../../src/postgres/repositories/SimulationRunsRepository';
import { getPostgresPool } from '../../src/postgres-client';

vi.mock('../../src/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('SimulationRunsRepository', () => {
  let repository: SimulationRunsRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new SimulationRunsRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('createRun', () => {
    it('should create a new simulation run', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await repository.createRun({
        runType: 'backtest',
        engineVersion: '1.0.0',
        configHash: 'abc123',
        config: {},
        dataSelection: {},
      });

      expect(result).toBe(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 2 }] });

      await repository.createRun({
        strategyId: 1,
        tokenId: 2,
        callerId: 3,
        runType: 'backtest',
        engineVersion: '1.0.0',
        configHash: 'abc123',
        config: {},
        dataSelection: {},
        status: 'pending',
      });

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(1); // strategyId
    });
  });

  describe('findById', () => {
    it('should find simulation run by ID', async () => {
      const mockRun = {
        id: 1,
        strategy_id: null,
        token_id: null,
        caller_id: null,
        run_type: 'backtest',
        engine_version: '1.0.0',
        config_hash: 'abc123',
        config_json: {},
        data_selection_json: {},
        status: 'completed',
        started_at: new Date(),
        completed_at: new Date(),
        error_message: null,
        created_at: new Date(),
      };
      mockPool.query.mockResolvedValue({ rows: [mockRun] });

      const result = await repository.findById(1);

      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.runType).toBe('backtest');
    });

    it('should return null if run not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update run status', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.updateStatus(1, 'running');

      expect(mockPool.query).toHaveBeenCalled();
      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('UPDATE');
      expect(query).toContain('status');
    });
  });
});
