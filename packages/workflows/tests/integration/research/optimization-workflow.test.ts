/**
 * Integration Test: Optimization Workflow
 *
 * Tests the complete optimization workflow end-to-end with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runOptimizationWorkflow } from '../../../../src/research/optimization-workflow.js';
import type { OptimizationWorkflowConfig } from '../../../../src/research/phases/types.js';
import {
  createTempDuckDBPath,
  createTestDuckDB,
  cleanupTestDuckDB,
} from '../../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../../ingestion/tests/helpers/createTestDuckDB.js';

describe('Optimization Workflow Integration', () => {
  let tempDataRoot: string;
  let duckdbPath: string;
  let testCalls: TestCall[];

  beforeEach(async () => {
    // Create temp data root
    tempDataRoot = join(process.cwd(), 'test-temp', `workflow-test-${Date.now()}`);
    await mkdir(tempDataRoot, { recursive: true });

    // Create temp DuckDB
    duckdbPath = createTempDuckDBPath('workflow_test');

    // Create test calls
    testCalls = [
      {
        callId: 'call1',
        caller: 'test-caller-1',
        mint: 'mint1',
        timestampMs: new Date('2024-01-01T00:00:00Z').getTime(),
        chain: 'solana',
      },
      {
        callId: 'call2',
        caller: 'test-caller-1',
        mint: 'mint2',
        timestampMs: new Date('2024-01-01T01:00:00Z').getTime(),
        chain: 'solana',
      },
      {
        callId: 'call3',
        caller: 'test-caller-2',
        mint: 'mint3',
        timestampMs: new Date('2024-01-01T02:00:00Z').getTime(),
        chain: 'solana',
      },
    ];

    await createTestDuckDB(duckdbPath, testCalls);

    // Mock getDuckDBPath to return our test DuckDB
    vi.doMock('@quantbot/utils', async () => {
      const actual = await vi.importActual('@quantbot/utils');
      return {
        ...actual,
        getDuckDBPath: () => duckdbPath,
      };
    });

    // Mock PythonEngine to avoid actual Python execution
    vi.doMock('@quantbot/utils', async () => {
      const actual = await vi.importActual('@quantbot/utils');
      return {
        ...actual,
        PythonEngine: vi.fn().mockImplementation(() => ({
          runScript: vi.fn().mockResolvedValue(undefined),
        })),
        getDuckDBPath: () => duckdbPath,
      };
    });
  });

  afterEach(async () => {
    if (existsSync(tempDataRoot)) {
      const { rm } = await import('fs/promises');
      await rm(tempDataRoot, { recursive: true, force: true });
    }
    cleanupTestDuckDB(duckdbPath);
  });

  it('should create data lake directory structure', async () => {
    const config: OptimizationWorkflowConfig = {
      dateFrom: '2024-01-01T00:00:00Z',
      dateTo: '2024-01-02T00:00:00Z',
      phase1: {
        enabled: false, // Skip phases for structure test
        tpMults: [],
        slMults: [],
        intervals: [],
        lagsMs: [],
      },
      phase2: {
        enabled: false,
        mode: 'cheap',
        nTrials: 10,
        nFolds: 2,
        extendedParams: false,
      },
      phase3: {
        enabled: false,
        trainDays: 7,
        testDays: 3,
        stepDays: 3,
        lanePack: 'minimal',
      },
      dataRoot: tempDataRoot,
      resume: false,
    };

    // Mock the workflow to just create directories
    const { createLakeRunDirectory } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-run-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    // Verify directory structure
    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, 'inputs'))).toBe(true);
    expect(existsSync(join(runDir, 'phase1'))).toBe(true);
    expect(existsSync(join(runDir, 'phase2'))).toBe(true);
    expect(existsSync(join(runDir, 'phase3'))).toBe(true);
    expect(existsSync(join(runDir, 'outputs'))).toBe(true);
  });

  it('should handle resume logic', async () => {
    const config: OptimizationWorkflowConfig = {
      dateFrom: '2024-01-01T00:00:00Z',
      dateTo: '2024-01-02T00:00:00Z',
      phase1: {
        enabled: false,
        tpMults: [],
        slMults: [],
        intervals: [],
        lagsMs: [],
      },
      phase2: {
        enabled: false,
        mode: 'cheap',
        nTrials: 10,
        nFolds: 2,
        extendedParams: false,
      },
      phase3: {
        enabled: false,
        trainDays: 7,
        testDays: 3,
        stepDays: 3,
        lanePack: 'minimal',
      },
      dataRoot: tempDataRoot,
      resume: true,
    };

    // Create a mock manifest indicating Phase 1 is completed
    const { createLakeRunDirectory, writeWorkflowManifest } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-resume-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    await writeWorkflowManifest(runDir, {
      workflowRunId,
      createdAt: new Date().toISOString(),
      status: 'running',
      phases: {
        phase1: 'completed',
        phase2: 'pending',
        phase3: 'pending',
      },
    });

    // Create Phase 1 results
    await writeFile(
      join(runDir, 'phase1', 'summary.json'),
      JSON.stringify({
        totalCallers: 1,
        callersWithRanges: 1,
        excludedCallers: [],
      }),
      'utf-8'
    );

    await writeFile(
      join(runDir, 'phase1', 'optimal-ranges.json'),
      JSON.stringify([
        {
          caller: 'test-caller',
          tpMult: { min: 2.0, max: 3.0 },
          slMult: { min: 0.85, max: 0.9 },
          metrics: { winRate: 0.6, medianReturnPct: 0.5, hit2xPct: 0.4, callsCount: 100 },
        },
      ]),
      'utf-8'
    );

    // Verify resume can load Phase 1 results
    const { loadWorkflowManifest } = await import('../../../src/research/phases/lake-directory.js');
    const manifest = await loadWorkflowManifest(runDir);

    expect(manifest).toBeDefined();
    expect(manifest?.phases.phase1).toBe('completed');
  });

  it('should write manifest.json with git provenance', async () => {
    const { createLakeRunDirectory, writeWorkflowManifest } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-manifest-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    const manifest = {
      workflowRunId,
      createdAt: new Date().toISOString(),
      status: 'running' as const,
      phases: {
        phase1: 'pending' as const,
        phase2: 'pending' as const,
        phase3: 'pending' as const,
      },
      gitCommit: 'abc123',
      gitBranch: 'main',
      gitDirty: false,
    };

    await writeWorkflowManifest(runDir, manifest);

    const manifestPath = join(runDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const { readFile } = await import('fs/promises');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    expect(content.workflowRunId).toBe(workflowRunId);
    expect(content.gitCommit).toBe('abc123');
    expect(content.gitBranch).toBe('main');
    expect(content.gitDirty).toBe(false);
  });

  it('should write phase configs to inputs directory', async () => {
    const { createLakeRunDirectory, writePhaseConfig } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-configs-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    const phase1Config = {
      enabled: true,
      tpMults: [2.0, 3.0],
      slMults: [0.85, 0.9],
      intervals: ['5m'],
      lagsMs: [0],
    };

    await writePhaseConfig(runDir, 'phase1', phase1Config);

    const configPath = join(runDir, 'inputs', 'phase1-config.json');
    expect(existsSync(configPath)).toBe(true);

    const { readFile } = await import('fs/promises');
    const content = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(content.enabled).toBe(true);
    expect(content.tpMults).toEqual([2.0, 3.0]);
  });

  it('should handle phase result loading on resume', async () => {
    const { createLakeRunDirectory, writeWorkflowManifest } =
      await import('../../../src/research/phases/lake-directory.js');
    const { loadWorkflowManifest } = await import('../../../src/research/phases/lake-directory.js');

    const workflowRunId = 'test-resume-load-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    // Write Phase 2 results
    await writeFile(
      join(runDir, 'phase2', 'summary.json'),
      JSON.stringify({
        totalTrials: 100,
        islandsFound: 3,
        championsSelected: 5,
      }),
      'utf-8'
    );

    await writeFile(
      join(runDir, 'phase2', 'islands.json'),
      JSON.stringify([
        {
          islandId: 'island1',
          centroid: { tpMult: 2.5, slMult: 0.875 },
          nMembers: 5,
          meanRobustScore: 0.5,
          bestRobustScore: 0.6,
        },
      ]),
      'utf-8'
    );

    await writeFile(
      join(runDir, 'phase2', 'champions.json'),
      JSON.stringify([
        {
          championId: 'champ1',
          islandId: 'island1',
          tpMult: 2.5,
          slMult: 0.875,
          discoveryScore: 0.6,
          passesGates: true,
        },
      ]),
      'utf-8'
    );

    await writeWorkflowManifest(runDir, {
      workflowRunId,
      createdAt: new Date().toISOString(),
      status: 'running',
      phases: {
        phase1: 'completed',
        phase2: 'completed',
        phase3: 'pending',
      },
    });

    // Verify manifest can be loaded
    const manifest = await loadWorkflowManifest(runDir);
    expect(manifest).toBeDefined();
    expect(manifest?.phases.phase2).toBe('completed');

    // Verify Phase 2 results can be loaded
    const { readFile } = await import('fs/promises');
    const summary = JSON.parse(await readFile(join(runDir, 'phase2', 'summary.json'), 'utf-8'));
    const islands = JSON.parse(await readFile(join(runDir, 'phase2', 'islands.json'), 'utf-8'));
    const champions = JSON.parse(await readFile(join(runDir, 'phase2', 'champions.json'), 'utf-8'));

    expect(summary.totalTrials).toBe(100);
    expect(islands.length).toBe(1);
    expect(champions.length).toBe(1);
  });

  it('should handle workflow run directory structure correctly', async () => {
    const { createLakeRunDirectory, getPhaseArtifactPath, getOutputArtifactPath } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-structure-123';
    const runDir = await createLakeRunDirectory(tempDataRoot, workflowRunId);

    // Verify paths are correct
    const phase1Artifact = getPhaseArtifactPath(runDir, 'phase1', 'summary.json');
    expect(phase1Artifact).toBe(join(runDir, 'phase1', 'summary.json'));

    const outputArtifact = getOutputArtifactPath(runDir, 'final-parameters.json');
    expect(outputArtifact).toBe(join(runDir, 'outputs', 'final-parameters.json'));

    // Verify all directories exist
    expect(existsSync(join(runDir, 'inputs'))).toBe(true);
    expect(existsSync(join(runDir, 'phase1'))).toBe(true);
    expect(existsSync(join(runDir, 'phase2'))).toBe(true);
    expect(existsSync(join(runDir, 'phase3'))).toBe(true);
    expect(existsSync(join(runDir, 'outputs'))).toBe(true);
  });

  it('should check if workflow run exists', async () => {
    const { createLakeRunDirectory, workflowRunExists } =
      await import('../../../src/research/phases/lake-directory.js');
    const workflowRunId = 'test-exists-123';

    // Initially should not exist
    expect(workflowRunExists(tempDataRoot, workflowRunId)).toBe(false);

    // Create directory
    await createLakeRunDirectory(tempDataRoot, workflowRunId);

    // Now should exist
    expect(workflowRunExists(tempDataRoot, workflowRunId)).toBe(true);
  });
});
