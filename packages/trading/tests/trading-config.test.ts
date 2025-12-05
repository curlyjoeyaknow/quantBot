/**
 * Trading Config Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TradingConfigService } from '../src/config/trading-config';
import type { TradingConfig } from '../src/types';

// Mock the queryPostgres function
const mockQueryPostgres = vi.fn();
vi.mock('@quantbot/storage', () => ({
  queryPostgres: (...args: any[]) => mockQueryPostgres(...args),
}));

describe('TradingConfigService', () => {
  let service: TradingConfigService;

  beforeEach(() => {
    service = new TradingConfigService();
    mockQueryPostgres.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should retrieve existing config', async () => {
      const mockRow = {
        user_id: '123',
        enabled: true,
        max_position_size: '1.0',
        max_total_exposure: '10.0',
        slippage_tolerance: '0.01',
        daily_loss_limit: '5.0',
        alert_rules_json: JSON.stringify({
          caDropAlerts: true,
          ichimokuSignals: false,
          liveTradeEntry: false,
        }),
        dry_run: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQueryPostgres.mockResolvedValue({ rows: [mockRow] });

      const config = await service.getConfig(123);

      expect(config).toBeDefined();
      expect(config?.userId).toBe(123);
      expect(config?.enabled).toBe(true);
      expect(config?.maxPositionSize).toBe(1.0);
      expect(config?.alertRules.caDropAlerts).toBe(true);
    });

    it('should return null for non-existent config', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const config = await service.getConfig(999);

      expect(config).toBeNull();
    });
  });

  describe('upsertConfig', () => {
    it('should create new config when none exists', async () => {
      // First call returns no existing config
      mockQueryPostgres.mockResolvedValueOnce({ rows: [] });

      // Second call creates the config
      const mockRow = {
        user_id: '123',
        enabled: true,
        max_position_size: '1.0',
        max_total_exposure: '10.0',
        slippage_tolerance: '0.01',
        daily_loss_limit: '5.0',
        alert_rules_json: '{}',
        dry_run: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockQueryPostgres.mockResolvedValueOnce({ rows: [mockRow] });

      const config = await service.upsertConfig({
        userId: 123,
        enabled: true,
      });

      expect(config).toBeDefined();
      expect(config.userId).toBe(123);
      expect(mockQueryPostgres).toHaveBeenCalledTimes(2);
    });

    it('should update existing config', async () => {
      // First call returns existing config
      const existingRow = {
        user_id: '123',
        enabled: false,
        max_position_size: '1.0',
        max_total_exposure: '10.0',
        slippage_tolerance: '0.01',
        daily_loss_limit: '5.0',
        alert_rules_json: '{}',
        dry_run: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockQueryPostgres.mockResolvedValueOnce({ rows: [existingRow] });

      // Second call updates the config
      const updatedRow = {
        ...existingRow,
        enabled: true,
      };
      mockQueryPostgres.mockResolvedValueOnce({ rows: [updatedRow] });

      const config = await service.upsertConfig({
        userId: 123,
        enabled: true,
      });

      expect(config.enabled).toBe(true);
      expect(mockQueryPostgres).toHaveBeenCalledTimes(2);
    });

    it('should use default values for new config', async () => {
      mockQueryPostgres.mockResolvedValueOnce({ rows: [] });

      const mockRow = {
        user_id: '123',
        enabled: false,
        max_position_size: '1.0',
        max_total_exposure: '10.0',
        slippage_tolerance: '0.01',
        daily_loss_limit: '5.0',
        alert_rules_json: JSON.stringify({
          caDropAlerts: false,
          ichimokuSignals: false,
          liveTradeEntry: false,
        }),
        dry_run: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockQueryPostgres.mockResolvedValueOnce({ rows: [mockRow] });

      const config = await service.upsertConfig({ userId: 123 });

      expect(config.maxPositionSize).toBe(1.0);
      expect(config.maxTotalExposure).toBe(10.0);
      expect(config.slippageTolerance).toBe(0.01);
      expect(config.dailyLossLimit).toBe(5.0);
      expect(config.dryRun).toBe(true);
    });
  });

  describe('enableTrading', () => {
    it('should enable trading for user', async () => {
      mockQueryPostgres.mockResolvedValueOnce({ rows: [] });
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          user_id: '123',
          enabled: true,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: '{}',
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await service.enableTrading(123);

      const updateCall = mockQueryPostgres.mock.calls[1];
      const sql = updateCall[0];
      const params = updateCall[1];

      // Should be creating or updating with enabled = true
      expect(params).toContain(true);
    });
  });

  describe('disableTrading', () => {
    it('should disable trading for user', async () => {
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          user_id: '123',
          enabled: true,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: '{}',
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          user_id: '123',
          enabled: false,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: '{}',
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await service.disableTrading(123);

      const updateCall = mockQueryPostgres.mock.calls[1];
      const params = updateCall[1];

      expect(params).toContain(false);
    });
  });

  describe('isTradingEnabled', () => {
    it('should return true when trading is enabled', async () => {
      mockQueryPostgres.mockResolvedValue({
        rows: [{
          user_id: '123',
          enabled: true,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: '{}',
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const isEnabled = await service.isTradingEnabled(123);

      expect(isEnabled).toBe(true);
    });

    it('should return false when trading is disabled', async () => {
      mockQueryPostgres.mockResolvedValue({
        rows: [{
          user_id: '123',
          enabled: false,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: '{}',
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const isEnabled = await service.isTradingEnabled(123);

      expect(isEnabled).toBe(false);
    });

    it('should return false when no config exists', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const isEnabled = await service.isTradingEnabled(999);

      expect(isEnabled).toBe(false);
    });
  });

  describe('alert rules', () => {
    it('should store custom alert rules', async () => {
      mockQueryPostgres.mockResolvedValueOnce({ rows: [] });
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          user_id: '123',
          enabled: true,
          max_position_size: '1.0',
          max_total_exposure: '10.0',
          slippage_tolerance: '0.01',
          daily_loss_limit: '5.0',
          alert_rules_json: JSON.stringify({
            caDropAlerts: true,
            ichimokuSignals: true,
            liveTradeEntry: false,
          }),
          dry_run: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const config = await service.upsertConfig({
        userId: 123,
        alertRules: {
          caDropAlerts: true,
          ichimokuSignals: true,
          liveTradeEntry: false,
        },
      });

      expect(config.alertRules.caDropAlerts).toBe(true);
      expect(config.alertRules.ichimokuSignals).toBe(true);
      expect(config.alertRules.liveTradeEntry).toBe(false);
    });
  });
});

