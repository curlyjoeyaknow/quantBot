/**
 * Sweep with Config Integration Tests
 *
 * End-to-end tests for config-first sweep workflow and resume functionality.
 *
 * These tests verify:
 * - Loading config from YAML/JSON files
 * - CLI override merging
 * - Complete sweep execution
 * - Resume functionality (skip completed scenarios)
 * - Artifact generation (per_call.jsonl, matrix.json, run.meta.json, etc.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { sweepCallsHandler } from '../../../src/commands/calls/sweep-calls.js';
import type { SweepCallsArgs } from '../../../src/command-defs/calls.js';
import type { CommandContext } from '../../../src/core/command-context.js';

const TEST_DIR = join(process.cwd(), '.test-sweep-integration');

// Mock calls data
const mockCalls = [
  {
    tsMs: Date.now(),
    caller: { fromId: 'caller-1', displayName: 'Caller 1' },
    token: { address: 'token-1', chain: 'solana' },
  },
  {
    tsMs: Date.now(),
    caller: { fromId: 'caller-2', displayName: 'Caller 2' },
    token: { address: 'token-2', chain: 'solana' },
  },
];

// Mock overlay sets
const mockOverlays = [
  {
    id: 'set-1',
    overlays: [
      { kind: 'take_profit', takePct: 100 },
      { kind: 'stop_loss', stopPct: 20 },
    ],
  },
];

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });

  // Write mock calls file
  writeFileSync(join(TEST_DIR, 'calls.json'), JSON.stringify(mockCalls));

  // Write mock overlays file
  writeFileSync(join(TEST_DIR, 'overlays.json'), JSON.stringify(mockOverlays));

  // Mock evaluateCallsWorkflow to avoid real API calls
  vi.mock('@quantbot/workflows', () => ({
    evaluateCallsWorkflow: vi.fn().mockResolvedValue({
      results: [
        {
          call: mockCalls[0],
          overlay: { kind: 'take_profit', takePct: 100 },
          entry: { tsMs: Date.now(), px: 1.0 },
          exit: { tsMs: Date.now() + 1000, px: 2.0, reason: 'take_profit' },
          pnl: {
            grossReturnPct: 100,
            netReturnPct: 99.6,
            feesUsd: 3,
            slippageUsd: 1,
          },
          diagnostics: { candlesUsed: 10, tradeable: true },
        },
      ],
      summaryByCaller: [
        {
          callerFromId: 'caller-1',
          callerName: 'Caller 1',
          calls: 1,
          tradeableCalls: 1,
          medianNetReturnPct: 99.6,
          winRate: 1.0,
          bestOverlay: { kind: 'take_profit', takePct: 100 },
        },
      ],
    }),
    createProductionContextWithPorts: vi.fn().mockResolvedValue({}),
  }));
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Sweep with Config', () => {
  describe('YAML config loading', () => {
    it('loads sweep config from YAML file', async () => {
      const configPath = join(TEST_DIR, 'sweep.yaml');
      writeFileSync(
        configPath,
        `
callsFile: ${join(TEST_DIR, 'calls.json')}
overlaySetsFile: ${join(TEST_DIR, 'overlays.json')}
out: ${join(TEST_DIR, 'out')}
intervals:
  - 1m
  - 5m
lagsMs:
  - 0
  - 10000
      `.trim()
      );

      const args: SweepCallsArgs = {
        config: configPath,
        callsFile: '', // Will be overridden by config
        intervals: [],
        lagsMs: [],
        out: '',
        entryRule: 'next_candle_open',
        timeframeMs: 86400000,
        takerFeeBps: 30,
        slippageBps: 10,
        notionalUsd: 1000,
        format: 'table',
        resume: false,
      };

      const mockCtx = {} as CommandContext;
      const result = await sweepCallsHandler(args, mockCtx);

      // Verify outputs exist
      const outDir = join(TEST_DIR, 'out');
      expect(existsSync(join(outDir, 'per_call.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'per_caller.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'matrix.json'))).toBe(true);
      expect(existsSync(join(outDir, 'run.meta.json'))).toBe(true);
      expect(existsSync(join(outDir, 'config.json'))).toBe(true);

      // Verify config was copied to output
      const savedConfig = JSON.parse(readFileSync(join(outDir, 'config.json'), 'utf-8'));
      expect(savedConfig.intervals).toEqual(['1m', '5m']);
      expect(savedConfig.lagsMs).toEqual([0, 10000]);

      // Verify scenarios were run (2 intervals × 2 lags × 1 overlay set = 4 scenarios)
      expect(result.totalScenarios).toBe(4);
    });

    it('merges CLI overrides into YAML config', async () => {
      const configPath = join(TEST_DIR, 'sweep.yaml');
      writeFileSync(
        configPath,
        `
callsFile: ${join(TEST_DIR, 'calls.json')}
overlaySetsFile: ${join(TEST_DIR, 'overlays.json')}
out: ${join(TEST_DIR, 'out')}
intervals:
  - 1m
lagsMs:
  - 0
takerFeeBps: 30
      `.trim()
      );

      const args: SweepCallsArgs = {
        config: configPath,
        callsFile: '', // Will be overridden by config
        intervals: [],
        lagsMs: [],
        out: '',
        entryRule: 'next_candle_open',
        timeframeMs: 86400000,
        takerFeeBps: 50, // Override from CLI
        slippageBps: 10,
        notionalUsd: 1000,
        format: 'table',
        resume: false,
      };

      const mockCtx = {} as CommandContext;
      await sweepCallsHandler(args, mockCtx);

      // Verify CLI override was applied
      const outDir = join(TEST_DIR, 'out');
      const savedConfig = JSON.parse(readFileSync(join(outDir, 'config.json'), 'utf-8'));
      expect(savedConfig.takerFeeBps).toBe(50);
    });
  });

  describe('JSON config loading', () => {
    it('loads sweep config from JSON file', async () => {
      const configPath = join(TEST_DIR, 'sweep.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          callsFile: join(TEST_DIR, 'calls.json'),
          overlaySetsFile: join(TEST_DIR, 'overlays.json'),
          out: join(TEST_DIR, 'out'),
          intervals: ['1m', '5m'],
          lagsMs: [0, 10000],
        })
      );

      const args: SweepCallsArgs = {
        config: configPath,
        callsFile: '',
        intervals: [],
        lagsMs: [],
        out: '',
        entryRule: 'next_candle_open',
        timeframeMs: 86400000,
        takerFeeBps: 30,
        slippageBps: 10,
        notionalUsd: 1000,
        format: 'table',
        resume: false,
      };

      const mockCtx = {} as CommandContext;
      const result = await sweepCallsHandler(args, mockCtx);

      // Verify outputs exist
      const outDir = join(TEST_DIR, 'out');
      expect(existsSync(join(outDir, 'per_call.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'matrix.json'))).toBe(true);

      // Verify scenarios were run
      expect(result.totalScenarios).toBe(4);
    });
  });

  describe('Resume functionality', () => {
    it('resumes from previous run by skipping completed scenarios', async () => {
      const outDir = join(TEST_DIR, 'out');
      mkdirSync(outDir, { recursive: true });

      // Create a previous run.meta.json with some completed scenarios
      const metaPath = join(outDir, 'run.meta.json');
      writeFileSync(
        metaPath,
        JSON.stringify({
          sweepId: 'sweep-previous',
          completedScenarioIds: ['scenario-1', 'scenario-2'],
        })
      );

      const configPath = join(TEST_DIR, 'sweep.yaml');
      writeFileSync(
        configPath,
        `
callsFile: ${join(TEST_DIR, 'calls.json')}
overlaySetsFile: ${join(TEST_DIR, 'overlays.json')}
out: ${outDir}
intervals:
  - 1m
  - 5m
lagsMs:
  - 0
  - 10000
resume: true
      `.trim()
      );

      const args: SweepCallsArgs = {
        config: configPath,
        callsFile: '',
        intervals: [],
        lagsMs: [],
        out: '',
        entryRule: 'next_candle_open',
        timeframeMs: 86400000,
        takerFeeBps: 30,
        slippageBps: 10,
        notionalUsd: 1000,
        format: 'table',
        resume: true,
      };

      const mockCtx = {} as CommandContext;
      const result = await sweepCallsHandler(args, mockCtx);

      // Verify only remaining scenarios were run
      // Total: 2 intervals × 2 lags × 1 overlay set = 4 scenarios
      // But 2 were already completed, so only 2 should run
      expect(result.totalScenarios).toBeLessThan(4);

      // Verify final run.meta.json includes all completed scenarios
      const finalMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(finalMeta.completedScenarioIds.length).toBeGreaterThan(2);
    });
  });

  describe('Artifact generation', () => {
    it('generates all required artifacts', async () => {
      const configPath = join(TEST_DIR, 'sweep.yaml');
      writeFileSync(
        configPath,
        `
callsFile: ${join(TEST_DIR, 'calls.json')}
overlaySetsFile: ${join(TEST_DIR, 'overlays.json')}
out: ${join(TEST_DIR, 'out')}
intervals:
  - 1m
lagsMs:
  - 0
      `.trim()
      );

      const args: SweepCallsArgs = {
        config: configPath,
        callsFile: '',
        intervals: [],
        lagsMs: [],
        out: '',
        entryRule: 'next_candle_open',
        timeframeMs: 86400000,
        takerFeeBps: 30,
        slippageBps: 10,
        notionalUsd: 1000,
        format: 'table',
        resume: false,
      };

      const mockCtx = {} as CommandContext;
      await sweepCallsHandler(args, mockCtx);

      const outDir = join(TEST_DIR, 'out');

      // Verify all artifacts exist
      expect(existsSync(join(outDir, 'per_call.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'per_caller.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'matrix.json'))).toBe(true);
      expect(existsSync(join(outDir, 'errors.jsonl'))).toBe(true);
      expect(existsSync(join(outDir, 'run.meta.json'))).toBe(true);
      expect(existsSync(join(outDir, 'config.json'))).toBe(true);

      // Verify run.meta.json contains required fields
      const meta = JSON.parse(readFileSync(join(outDir, 'run.meta.json'), 'utf-8'));
      expect(meta).toMatchObject({
        sweepId: expect.stringMatching(/^sweep-/),
        startedAtISO: expect.any(String),
        completedAtISO: expect.any(String),
        durationMs: expect.any(Number),
        gitSha: expect.any(String),
        configHash: expect.any(String),
        config: expect.any(Object),
        counts: {
          totalRuns: expect.any(Number),
          totalResults: expect.any(Number),
          totalCallerSummaries: expect.any(Number),
        },
        diagnostics: expect.any(Object),
        completedScenarioIds: expect.any(Array),
      });
    });
  });
});
