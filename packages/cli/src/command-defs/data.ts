import { z } from 'zod';

/**
 * Schema for data feature-store version command
 */
export const dataFeatureStoreVersionSchema = z.object({
  featureSetId: z.string().min(1),
  format: z.enum(['json', 'table']).default('table'),
});

export type DataFeatureStoreVersionArgs = z.infer<typeof dataFeatureStoreVersionSchema>;

/**
 * Schema for data feature-store list-versions command
 */
export const dataFeatureStoreListVersionsSchema = z.object({
  featureSetId: z.string().min(1),
  format: z.enum(['json', 'table']).default('table'),
});

export type DataFeatureStoreListVersionsArgs = z.infer<typeof dataFeatureStoreListVersionsSchema>;

/**
 * Schema for data check-hash command
 */
export const dataCheckHashSchema = z.object({
  hash: z.string().min(1),
  format: z.enum(['json', 'table']).default('table'),
});

export type DataCheckHashArgs = z.infer<typeof dataCheckHashSchema>;
