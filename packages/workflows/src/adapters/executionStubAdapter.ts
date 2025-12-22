/**
 * ExecutionPort Stub Adapter (Safety-First)
 *
 * This adapter implements ExecutionPort with safety-first features:
 * - Dry-run mode (required - prevents accidental execution)
 * - Circuit breaker behavior (tracks failures, stops after threshold)
 * - Idempotency key support (prevents double-execution)
 * - Structured error handling
 *
 * **IMPORTANT**: This is a stub adapter. It does NOT execute real trades.
 *
 * **Architecture**: Live execution is intentionally isolated in an executor app boundary
 * (`apps/executor` or `packages/executor`). This stub adapter exists to:
 * 1. Provide a safety-first interface for testing workflows
 * 2. Enable workflow development without real execution dependencies
 * 3. Demonstrate the ExecutionPort contract and safety features
 *
 * **Real Execution**: When live trading is needed, create a concrete adapter in the
 * executor app boundary that:
 * - Manages keypairs/wallets securely
 * - Builds and signs Solana transactions
 * - Submits via Jito bundles or RPC
 * - Implements risk gates and monitoring
 * - Maintains all safety features (dry-run, circuit breaker, idempotency)
 *
 * **SAFETY WARNINGS**:
 * - Always use dry-run mode in development/testing
 * - Never disable idempotency checks
 * - Monitor circuit breaker state in production
 * - Log all execution attempts (even dry-run)
 */

import type {
  ExecutionPort,
  ExecutionRequest,
  ExecutionResult,
} from '@quantbot/core';

export type ExecutionStubAdapterConfig = {
  /**
   * Dry-run mode: if true, never execute real trades (always simulate)
   * Default: true (safety-first)
   */
  dryRun?: boolean;

  /**
   * Circuit breaker: max consecutive failures before stopping
   * Default: 5
   */
  maxConsecutiveFailures?: number;

  /**
   * Idempotency: enable idempotency key checking
   * Default: true (safety-first)
   */
  enableIdempotency?: boolean;

  /**
   * Simulated execution delay (ms) for dry-run mode
   * Default: 100ms
   */
  simulatedDelayMs?: number;
};

type CircuitBreakerState = {
  consecutiveFailures: number;
  isOpen: boolean;
  lastFailureTime?: number;
};

type IdempotencyRecord = {
  request: ExecutionRequest;
  result: ExecutionResult;
  timestamp: number;
};

/**
 * Create ExecutionPort stub adapter with safety-first features
 *
 * This adapter:
 * 1. Supports dry-run mode (required for safety)
 * 2. Implements circuit breaker (stops after max failures)
 * 3. Enforces idempotency (prevents double-execution)
 * 4. Provides structured error handling
 *
 * **When to replace**: When a real execution client (Jito, RPC) is available,
 * create a concrete adapter (e.g., executionJitoAdapter.ts) that wraps the client
 * but maintains the same safety features.
 */
export function createExecutionStubAdapter(
  config: ExecutionStubAdapterConfig = {}
): ExecutionPort {
  const {
    dryRun = true, // Safety-first: default to dry-run
    maxConsecutiveFailures = 5,
    enableIdempotency = true,
    simulatedDelayMs = 100,
  } = config;

  // Circuit breaker state
  const circuitBreaker: CircuitBreakerState = {
    consecutiveFailures: 0,
    isOpen: false,
  };

  // Idempotency store (in-memory for stub; real adapter should use StatePort)
  const idempotencyStore = new Map<string, IdempotencyRecord>();

  /**
   * Generate idempotency key from request
   * Real adapter should use: `${request.tokenAddress}-${request.side}-${request.amount}-${timestamp}`
   */
  function generateIdempotencyKey(request: ExecutionRequest): string {
    // Simple key: token + side + amount (rounded to avoid float precision issues)
    const amountKey = Math.round(request.amount * 1000) / 1000;
    return `${request.tokenAddress}-${request.side}-${amountKey}`;
  }

  /**
   * Check circuit breaker state
   */
  function checkCircuitBreaker(): { allowed: boolean; reason?: string } {
    if (circuitBreaker.isOpen) {
      // Circuit is open - check if we should reset (after 60 seconds)
      const resetAfterMs = 60_000;
      if (
        circuitBreaker.lastFailureTime &&
        Date.now() - circuitBreaker.lastFailureTime > resetAfterMs
      ) {
        // Reset circuit breaker
        circuitBreaker.isOpen = false;
        circuitBreaker.consecutiveFailures = 0;
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Circuit breaker is open (too many consecutive failures)',
      };
    }
    return { allowed: true };
  }

  /**
   * Record failure in circuit breaker
   */
  function recordFailure(): void {
    circuitBreaker.consecutiveFailures += 1;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.consecutiveFailures >= maxConsecutiveFailures) {
      circuitBreaker.isOpen = true;
        console.warn(
          `[ExecutionPort] Circuit breaker opened after ${circuitBreaker.consecutiveFailures} consecutive failures`
        );
    }
  }

  /**
   * Record success in circuit breaker
   */
  function recordSuccess(): void {
    circuitBreaker.consecutiveFailures = 0;
    circuitBreaker.isOpen = false;
  }

  return {
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      // 1. Check circuit breaker
      const circuitCheck = checkCircuitBreaker();
      if (!circuitCheck.allowed) {
        return {
          success: false,
          error: circuitCheck.reason,
        };
      }

      // 2. Check idempotency (if enabled)
      if (enableIdempotency) {
        const idempotencyKey = generateIdempotencyKey(request);
        const existing = idempotencyStore.get(idempotencyKey);

        if (existing) {
          // Return cached result (idempotent)
        console.log(
          `[ExecutionPort] Idempotency hit: returning cached result for ${idempotencyKey}`
        );
          return existing.result;
        }
      }

      // 3. Dry-run mode check
      if (dryRun) {
        // Simulate execution delay
        await new Promise((resolve) => setTimeout(resolve, simulatedDelayMs));

        // Simulate successful execution (dry-run)
        const simulatedResult: ExecutionResult = {
          success: true,
          txSignature: `dry-run-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          executedPrice: 0.001, // Simulated price
          executedAmount: request.amount,
          fees: {
            networkFee: 5000, // Simulated network fee (lamports)
            priorityFee: (request.priorityFee ?? 0) * 200_000, // Simulated priority fee
            totalFee: 5000 + (request.priorityFee ?? 0) * 200_000,
          },
        };

        // Store in idempotency cache (if enabled)
        if (enableIdempotency) {
          const idempotencyKey = generateIdempotencyKey(request);
          idempotencyStore.set(idempotencyKey, {
            request,
            result: simulatedResult,
            timestamp: Date.now(),
          });
        }

        recordSuccess();

        console.log(
          `[ExecutionPort] DRY-RUN: Simulated ${request.side} of ${request.amount} ${request.tokenAddress}`
        );

        return simulatedResult;
      }

      // 4. Real execution (not implemented in stub)
      // When replacing with real adapter, implement actual execution here
      const error = 'Real execution not implemented in stub adapter. Use dry-run mode or replace with concrete adapter.';
      recordFailure();

      return {
        success: false,
        error,
      };
    },

    async isAvailable(): Promise<boolean> {
      // Check circuit breaker state
      const circuitCheck = checkCircuitBreaker();
      return circuitCheck.allowed;
    },
  };
}

