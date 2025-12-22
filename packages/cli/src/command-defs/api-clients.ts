import { z } from 'zod';

export const testSchema = z.object({
  service: z.enum(['birdeye', 'helius']),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const statusSchema = z.object({
  service: z.enum(['birdeye', 'helius', 'all']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const creditsSchema = z.object({
  service: z.enum(['birdeye', 'helius', 'all']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type TestApiClientsArgs = z.infer<typeof testSchema>;
export type StatusApiClientsArgs = z.infer<typeof statusSchema>;
export type CreditsApiClientsArgs = z.infer<typeof creditsSchema>;
