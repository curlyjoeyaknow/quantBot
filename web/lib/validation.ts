/**
 * Form validation schemas using Zod
 */

import { z } from 'zod';

export const configUpdateSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string(),
});

export const callerHistoryFiltersSchema = z.object({
  caller: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minMarketCap: z.string().optional(),
  maxMarketCap: z.string().optional(),
  minMaxGain: z.string().optional(),
  maxMaxGain: z.string().optional(),
  isDuplicate: z.string().optional(),
});

export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;
export type CallerHistoryFiltersInput = z.infer<typeof callerHistoryFiltersSchema>;

/**
 * Sanitize string input to prevent injection attacks
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
    .slice(0, 1000); // Limit length
}

/**
 * Validate date range
 */
export function validateDateRange(startDate?: string, endDate?: string): { valid: boolean; error?: string; start?: Date; end?: Date } {
  if (!startDate && !endDate) {
    return { valid: true };
  }
  
  const start = startDate ? new Date(startDate) : undefined;
  const end = endDate ? new Date(endDate) : undefined;
  
  if (start && isNaN(start.getTime())) {
    return { valid: false, error: 'Invalid start date' };
  }
  if (end && isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid end date' };
  }
  if (start && end && start > end) {
    return { valid: false, error: 'Start date must be before end date' };
  }
  
  return { valid: true, start, end };
}

/**
 * Validate numeric range
 */
export function validateNumericRange(
  min?: string | number,
  max?: string | number,
  fieldName: string = 'value'
): { valid: boolean; error?: string; min?: number; max?: number } {
  if (!min && !max) {
    return { valid: true };
  }
  
  const minNum = min !== undefined ? (typeof min === 'string' ? parseFloat(min) : min) : undefined;
  const maxNum = max !== undefined ? (typeof max === 'string' ? parseFloat(max) : max) : undefined;
  
  if (minNum !== undefined && (isNaN(minNum) || minNum < 0)) {
    return { valid: false, error: `Invalid minimum ${fieldName}` };
  }
  if (maxNum !== undefined && (isNaN(maxNum) || maxNum < 0)) {
    return { valid: false, error: `Invalid maximum ${fieldName}` };
  }
  if (minNum !== undefined && maxNum !== undefined && minNum > maxNum) {
    return { valid: false, error: `Minimum ${fieldName} must be less than or equal to maximum ${fieldName}` };
  }
  
  return { valid: true, min: minNum, max: maxNum };
}

/**
 * Validate pagination parameters
 */
export function validatePageParams(page?: string | number, limit?: string | number): { valid: boolean; error?: string; page: number; limit: number } {
  const pageNum = page !== undefined 
    ? Math.max(1, typeof page === 'string' ? (parseInt(page, 10) || 1) : page)
    : 1;
  const limitNum = limit !== undefined
    ? Math.min(100, Math.max(1, typeof limit === 'string' ? (parseInt(limit, 10) || 20) : limit))
    : 20;
  
  if (isNaN(pageNum) || pageNum < 1) {
    return { valid: false, error: 'Invalid page number', page: 1, limit: limitNum };
  }
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return { valid: false, error: 'Invalid page size (must be between 1 and 100)', page: pageNum, limit: 20 };
  }
  
  return { valid: true, page: pageNum, limit: limitNum };
}
