import { z } from 'zod';

/**
 * Schema for architecture verify-boundaries command
 */
export const architectureVerifyBoundariesSchema = z.object({
  format: z.enum(['json', 'table']).default('table'),
});

export type ArchitectureVerifyBoundariesArgs = z.infer<typeof architectureVerifyBoundariesSchema>;

/**
 * Schema for architecture test-boundaries command
 */
export const architectureTestBoundariesSchema = z.object({
  format: z.enum(['json', 'table']).default('table'),
});

export type ArchitectureTestBoundariesArgs = z.infer<typeof architectureTestBoundariesSchema>;
