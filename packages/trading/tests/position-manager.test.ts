/**
 * Position Manager Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PositionManager } from '../src/positions/position-manager';
import type { OpenPositionParams } from '../src/types';

// Mock the queryPostgres function
const mockQueryPostgres = vi.fn();
vi.mock('@quantbot/storage', () => ({
  queryPostgres: (...args: any[]) => mockQueryPostgres(...args),
}));

describe('PositionManager', () => {
  let positionManager: PositionManager;

  beforeEach(() => {
    positionManager = new PositionManager();
    mockQueryPostgres.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('openPosition', () => {
    const sampleParams: OpenPositionParams = {
      userId: 123,
      tokenId: 456,
      walletId: 789,
      entryPrice: 1.5,
      amount: 1000,
      strategyConfig: {
        stopLoss: 0.1,
        takeProfit: 0.2,
      },
    };

    it('should create a new position', async () => {
      const mockRow = {
        id: '1',
        user_id: '123',
        token_id: '456',
        wallet_id: '789',
        entry_price: '1.5',
        entry_amount: '1000',
        current_amount: '1000',
        entry_timestamp: new Date(),
        status: 'open',
        strategy_config_json: JSON.stringify(sampleParams.strategyConfig),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const position = await positionManager.openPosition(sampleParams);

      expect(position).toBeDefined();
      expect(position.id).toBe(1);
      expect(position.userId).toBe(123);
      expect(position.tokenId).toBe(456);
      expect(position.entryPrice).toBe(1.5);
      expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
    });

    it('should include metadata when provided', async () => {
      const paramsWithMetadata = {
        ...sampleParams,
        metadata: { note: 'Test position' },
      };

      mockQueryPostgres.mockResolvedValue({
        rows: [{
          id: '1',
          user_id: '123',
          token_id: '456',
          wallet_id: '789',
          entry_price: '1.5',
          entry_amount: '1000',
          current_amount: '1000',
          entry_timestamp: new Date(),
          status: 'open',
          strategy_config_json: '{}',
          metadata_json: JSON.stringify({ note: 'Test position' }),
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await positionManager.openPosition(paramsWithMetadata);

      const call = mockQueryPostgres.mock.calls[0];
      expect(call[1]).toContain(JSON.stringify({ note: 'Test position' }));
    });
  });

  describe('updatePosition', () => {
    it('should update position amount', async () => {
      const mockRow = {
        id: '1',
        user_id: '123',
        token_id: '456',
        wallet_id: '789',
        entry_price: '1.5',
        entry_amount: '1000',
        current_amount: '500',
        entry_timestamp: new Date(),
        status: 'open',
        strategy_config_json: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const position = await positionManager.updatePosition(1, { currentAmount: 500 });

      expect(position.currentAmount).toBe(500);
      expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
    });

    it('should update position status', async () => {
      const mockRow = {
        id: '1',
        user_id: '123',
        token_id: '456',
        wallet_id: '789',
        entry_price: '1.5',
        entry_amount: '1000',
        current_amount: '1000',
        entry_timestamp: new Date(),
        status: 'closed',
        strategy_config_json: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const position = await positionManager.updatePosition(1, { status: 'closed' });

      expect(position.status).toBe('closed');
    });

    it('should handle no changes gracefully', async () => {
      await expect(
        positionManager.updatePosition(1, {})
      ).rejects.toThrow('No fields to update');
    });
  });

  describe('closePosition', () => {
    it('should close a position', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      await positionManager.closePosition(1);

      expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
      const call = mockQueryPostgres.mock.calls[0];
      expect(call[0]).toContain('UPDATE positions');
      expect(call[0]).toContain("status = 'closed'");
    });
  });

  describe('getPosition', () => {
    it('should retrieve a position by ID', async () => {
      const mockRow = {
        id: '1',
        user_id: '123',
        token_id: '456',
        wallet_id: '789',
        entry_price: '1.5',
        entry_amount: '1000',
        current_amount: '1000',
        entry_timestamp: new Date(),
        status: 'open',
        strategy_config_json: '{"stopLoss":0.1}',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const position = await positionManager.getPosition(1);

      expect(position).toBeDefined();
      expect(position?.id).toBe(1);
      expect(position?.strategyConfig.stopLoss).toBe(0.1);
    });

    it('should return null for non-existent position', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const position = await positionManager.getPosition(999);

      expect(position).toBeNull();
    });
  });

  describe('getOpenPositions', () => {
    it('should retrieve all open positions for a user', async () => {
      const mockRows = [
        {
          id: '1',
          user_id: '123',
          token_id: '456',
          wallet_id: '789',
          entry_price: '1.5',
          entry_amount: '1000',
          current_amount: '1000',
          entry_timestamp: new Date(),
          status: 'open',
          strategy_config_json: '{}',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: '2',
          user_id: '123',
          token_id: '457',
          wallet_id: '789',
          entry_price: '2.0',
          entry_amount: '2000',
          current_amount: '2000',
          entry_timestamp: new Date(),
          status: 'open',
          strategy_config_json: '{}',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockQueryPostgres.mockResolvedValue({ rows: mockRows });

      const positions = await positionManager.getOpenPositions(123);

      expect(positions).toHaveLength(2);
      expect(positions[0].status).toBe('open');
      expect(positions[1].status).toBe('open');
    });

    it('should return empty array when no open positions', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const positions = await positionManager.getOpenPositions(123);

      expect(positions).toEqual([]);
    });
  });

  describe('calculatePnL', () => {
    it('should calculate positive PnL', () => {
      const pnl = positionManager.calculatePnL(
        1.0,  // entry price
        1.2,  // current price
        1000  // amount
      );

      expect(pnl).toBeCloseTo(200, 2); // 20% gain on 1000 = 200
    });

    it('should calculate negative PnL', () => {
      const pnl = positionManager.calculatePnL(
        1.0,  // entry price
        0.8,  // current price
        1000  // amount
      );

      expect(pnl).toBeCloseTo(-200, 2); // 20% loss on 1000 = -200
    });

    it('should return zero for breakeven', () => {
      const pnl = positionManager.calculatePnL(1.0, 1.0, 1000);
      expect(pnl).toBe(0);
    });

    it('should handle zero amount', () => {
      const pnl = positionManager.calculatePnL(1.0, 1.5, 0);
      expect(pnl).toBe(0);
    });
  });

  describe('remaining size calculation', () => {
    it('should calculate remaining size from current amount', async () => {
      const mockRow = {
        id: '1',
        user_id: '123',
        token_id: '456',
        wallet_id: '789',
        entry_price: '1.5',
        entry_amount: '1000',
        current_amount: '500',
        entry_timestamp: new Date(),
        status: 'open',
        strategy_config_json: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const position = await positionManager.getPosition(1);

      expect(position?.currentAmount).toBe(500);
      // remainingSize would be currentAmount * entryPrice = 500 * 1.5 = 750
    });
  });
});

