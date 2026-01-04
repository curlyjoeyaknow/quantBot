/**
 * Error Handler - User-friendly error messages, no secret leakage
 */

import { logger } from '@quantbot/utils';

/**
 * Sensitive patterns that should never appear in error messages
 */
const SENSITIVE_PATTERNS = [
  /api[_-]?key/gi,
  /token/gi,
  /secret/gi,
  /password/gi,
  /private[_-]?key/gi,
  /bearer/gi,
  /authorization/gi,
];

/**
 * Check if a string contains sensitive information
 */
function containsSensitiveInfo(message: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Sanitize error message to remove sensitive information
 */
function sanitizeErrorMessage(message: string): string {
  // If message contains sensitive patterns, return generic message
  if (containsSensitiveInfo(message)) {
    return 'An error occurred. Please check your configuration and try again.';
  }

  return message;
}

/**
 * Format error for user display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const message = sanitizeErrorMessage(error.message);
    return message;
  }

  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }

  return 'An unexpected error occurred';
}

/**
 * Handle Solana-specific errors
 */
export function handleSolanaError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // API errors (check first - more specific)
    if (message.includes('rate limit') || message.includes('429')) {
      return 'API rate limit exceeded. Please wait and try again.';
    }

    // ClickHouse connection errors
    if (message.includes('clickhouse') || message.includes('8123')) {
      return 'ClickHouse connection error. Please check that ClickHouse is running and the --ch-url is correct.';
    }

    // Solana RPC errors (must mention solana explicitly or known RPC patterns)
    if (
      (message.includes('solana') && message.includes('rpc')) ||
      message.includes('rpc endpoint') ||
      message.includes('rpc error')
    ) {
      return 'Solana RPC error. Please check your RPC endpoint and try again.';
    }

    // Generic network/connection errors
    if (message.includes('econnrefused') || message.includes('network error')) {
      return 'Connection refused. Please check that the target service is running.';
    }

    // Mint address validation errors (be more specific)
    if (
      message.includes('invalid mint') ||
      message.includes('invalid address') ||
      (message.includes('mint') && message.includes('format'))
    ) {
      return 'Invalid mint address. Please ensure the address is 32-44 characters and correctly formatted.';
    }
  }

  return formatError(error);
}

/**
 * Log error with full context (for debugging)
 * This should include full error details, but never expose secrets
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  const sanitizedContext = context
    ? Object.fromEntries(
        Object.entries(context).map(([key, value]) => [
          key,
          containsSensitiveInfo(String(value)) ? '[REDACTED]' : value,
        ])
      )
    : undefined;

  if (error instanceof Error) {
    logger.error('CLI error', {
      message: error.message,
      stack: error.stack,
      context: sanitizedContext,
    });
  } else {
    logger.error('CLI error', {
      error: String(error),
      context: sanitizedContext,
    });
  }
}

/**
 * Handle and format error for CLI output
 */
export function handleError(error: unknown, context?: Record<string, unknown>): string {
  // Log full error for debugging
  logError(error, context);

  // Return user-friendly message
  return handleSolanaError(error);
}
