import { z } from 'zod';

export const healthSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const quotasSchema = z.object({
  service: z.enum(['birdeye', 'helius', 'all']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const errorsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(10000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type HealthObservabilityArgs = z.infer<typeof healthSchema>;
export type QuotasObservabilityArgs = z.infer<typeof quotasSchema>;
export type ErrorsObservabilityArgs = z.infer<typeof errorsSchema>;
