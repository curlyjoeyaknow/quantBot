import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitoringEngine } from '../../src/engine/MonitoringEngine';
import type { Telegraf } from 'telegraf';

vi.mock('../../src/live-trade-alert-service', () => ({
  LiveTradeAlertService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ isRunning: false }),
  })),
}));

vi.mock('../../src/tenkan-kijun-alert-service', () => ({
  TenkanKijunAlertService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('../../src/helius-monitor', () => ({
  HeliusMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('../../src/brook-call-ingestion', () => ({
  BrookCallIngestion: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockReturnValue(undefined),
  })),
}));

vi.mock('../../src/curlyjoe-call-ingestion', () => ({
  CurlyJoeCallIngestion: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('MonitoringEngine', () => {
  let engine: MonitoringEngine;
  let mockBot: Telegraf;

  beforeEach(() => {
    mockBot = {} as unknown as Telegraf;
    engine = new MonitoringEngine({
      enableLiveTradeAlerts: true,
      enableTenkanKijunAlerts: true,
      enableHeliusMonitor: true,
      bot: mockBot,
    });
  });

  describe('initialize', () => {
    it('should initialize all enabled services', async () => {
      await engine.initialize();
      const status = engine.getStatus();
      expect(status).toBeDefined();
    });

    it('should only initialize enabled services', async () => {
      const minimalEngine = new MonitoringEngine({
        enableLiveTradeAlerts: false,
      });
      await minimalEngine.initialize();
      expect(minimalEngine.getStatus()).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start all initialized services', async () => {
      await engine.initialize();
      await engine.start();
      const status = engine.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should not start if already running', async () => {
      await engine.initialize();
      await engine.start();
      await engine.start(); // Second call
      const status = engine.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop all services', async () => {
      await engine.initialize();
      await engine.start();
      await engine.stop();
      const status = engine.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('should not stop if not running', async () => {
      await engine.stop(); // Stop without starting
      const status = engine.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return status of all services', async () => {
      await engine.initialize();
      const status = engine.getStatus();
      expect(status.services).toBeDefined();
      expect(status.services.liveTradeAlerts).toBeDefined();
      expect(status.services.tenkanKijunAlerts).toBeDefined();
      expect(status.services.heliusMonitor).toBeDefined();
    });
  });
});

