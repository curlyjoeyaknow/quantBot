/**
 * Features Command Definitions
 */

import { z } from 'zod';

export const featuresListSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const featuresComputeSchema = z.object({
  featureSet: z.string(),
  from: z.string().optional(), // ISO 8601 date
  to: z.string().optional(), // ISO 8601 date
  format: z.enum(['json', 'table', 'csv']).default('table'),
});
