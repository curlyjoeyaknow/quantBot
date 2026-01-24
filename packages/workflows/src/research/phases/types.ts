/**
 * Optimization Workflow Types
 *
 * Type definitions for the multi-phase optimization workflow.
 */

import { z } from 'zod';

/**
 * Phase 1 Configuration: Lab Sweep Discovery
 */
export const Phase1ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tpMults: z.array(z.number().positive()).default([1.5, 2.0, 2.5, 3.0, 4.0, 5.0]),
  slMults: z.array(z.number().min(0).max(1)).default([0.80, 0.85, 0.90, 0.95]),
  intervals: z.array(z.enum(['1m', '5m', '15m', '1h'])).default(['1m', '5m', '15m', '1h']),
  lagsMs: z.array(z.number().int().nonnegative()).default([0, 10000, 30000]),
  minCallsPerCaller: z.number().int().positive().optional(),
});

export type Phase1Config = z.infer<typeof Phase1ConfigSchema>;

/**
 * Phase 1 Results: Optimal Ranges per Caller
 */
export const OptimalRangeSchema = z.object({
  caller: z.string(),
  tpMult: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
    optimal: z.number().positive().optional(),
  }),
  slMult: z.object({
    min: z.number().min(0).max(1),
    max: z.number().min(0).max(1),
    optimal: z.number().min(0).max(1).optional(),
  }),
  interval: z.string().optional(),
  lagMs: z.number().int().nonnegative().optional(),
  metrics: z.object({
    winRate: z.number().min(0).max(1),
    medianReturnPct: z.number(),
    hit2xPct: z.number().min(0).max(1),
    callsCount: z.number().int().positive(),
  }),
});

export type OptimalRange = z.infer<typeof OptimalRangeSchema>;

export const Phase1ResultSchema = z.object({
  optimalRanges: z.array(OptimalRangeSchema),
  summary: z.object({
    totalCallers: z.number().int().nonnegative(),
    callersWithRanges: z.number().int().nonnegative(),
    excludedCallers: z.array(z.string()),
  }),
});

export type Phase1Result = z.infer<typeof Phase1ResultSchema>;

/**
 * Phase 2 Configuration: Backtest Optimization
 */
export const Phase2ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['cheap', 'serious', 'war_room']).default('serious'),
  nTrials: z.number().int().positive().default(1000),
  nFolds: z.number().int().positive().default(5),
  extendedParams: z.boolean().default(true),
});

export type Phase2Config = z.infer<typeof Phase2ConfigSchema>;

/**
 * Phase 2 Results: Islands and Champions
 */
export const ParameterIslandSchema = z.object({
  islandId: z.string(),
  centroid: z.object({
    tpMult: z.number().positive(),
    slMult: z.number().min(0).max(1),
    paramsJson: z.string(),
  }),
  nMembers: z.number().int().positive(),
  meanRobustScore: z.number(),
  bestRobustScore: z.number(),
});

export const IslandChampionSchema = z.object({
  championId: z.string(),
  islandId: z.string(),
  tpMult: z.number().positive(),
  slMult: z.number().min(0).max(1),
  paramsJson: z.string(),
  discoveryScore: z.number(),
  passesGates: z.boolean(),
});

export const Phase2ResultSchema = z.object({
  islands: z.array(ParameterIslandSchema),
  champions: z.array(IslandChampionSchema),
  summary: z.object({
    totalTrials: z.number().int().nonnegative(),
    islandsFound: z.number().int().nonnegative(),
    championsSelected: z.number().int().nonnegative(),
  }),
});

export type Phase2Result = z.infer<typeof Phase2ResultSchema>;

/**
 * Phase 3 Configuration: Stress Validation
 */
export const Phase3ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  trainDays: z.number().int().positive().default(14),
  testDays: z.number().int().positive().default(7),
  stepDays: z.number().int().positive().default(7),
  lanePack: z.enum(['minimal', 'full']).default('full'),
});

export type Phase3Config = z.infer<typeof Phase3ConfigSchema>;

/**
 * Phase 3 Results: Stress Validation
 */
export const StressWindowResultSchema = z.object({
  windowId: z.string(),
  trainFrom: z.string(),
  trainTo: z.string(),
  testFrom: z.string(),
  testTo: z.string(),
  laneResults: z.record(
    z.string(),
    z.object({
      testR: z.number(),
      ratio: z.number(),
      passesGates: z.boolean(),
    })
  ),
});

export const ChampionValidationSchema = z.object({
  championId: z.string(),
  windows: z.array(StressWindowResultSchema),
  maximinScore: z.number(),
  medianScore: z.number(),
  meanScore: z.number(),
  worstWindow: z.string(),
  worstLane: z.string(),
  validationRank: z.number().int().positive().optional(),
});

export const Phase3ResultSchema = z.object({
  validations: z.array(ChampionValidationSchema),
  winner: ChampionValidationSchema.optional(),
  summary: z.object({
    totalWindows: z.number().int().nonnegative(),
    championsValidated: z.number().int().nonnegative(),
  }),
});

export type Phase3Result = z.infer<typeof Phase3ResultSchema>;

/**
 * Complete Optimization Workflow Configuration
 */
export const OptimizationWorkflowConfigSchema = z.object({
  // Data
  dateFrom: z.string(),
  dateTo: z.string(),
  callers: z.array(z.string()).optional(),

  // Phases
  phase1: Phase1ConfigSchema,
  phase2: Phase2ConfigSchema,
  phase3: Phase3ConfigSchema,

  // Output
  dataRoot: z.string().default('data'),
  resume: z.boolean().default(false),
});

export type OptimizationWorkflowConfig = z.infer<typeof OptimizationWorkflowConfigSchema>;

/**
 * Workflow Run Metadata
 */
export const WorkflowRunMetadataSchema = z.object({
  workflowRunId: z.string(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  phases: z.object({
    phase1: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']).optional(),
    phase2: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']).optional(),
    phase3: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']).optional(),
  }),
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
  gitDirty: z.boolean().optional(),
});

export type WorkflowRunMetadata = z.infer<typeof WorkflowRunMetadataSchema>;

/**
 * Complete Workflow Result
 */
export const OptimizationWorkflowResultSchema = z.object({
  workflowRunId: z.string(),
  metadata: WorkflowRunMetadataSchema,
  phase1: Phase1ResultSchema.optional(),
  phase2: Phase2ResultSchema.optional(),
  phase3: Phase3ResultSchema.optional(),
  error: z.string().optional(),
});

export type OptimizationWorkflowResult = z.infer<typeof OptimizationWorkflowResultSchema>;

