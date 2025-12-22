/**
 * State Port
 *
 * Port interface for state storage (Redis, SQL databases, etc.).
 * Adapters implement this port to provide state management capabilities.
 */

/**
 * State key-value operations
 */
export type StateGetRequest = {
  key: string;
  namespace?: string; // Optional namespace for key scoping
};

export type StateSetRequest = {
  key: string;
  value: string | number | boolean | object;
  namespace?: string;
  ttlSeconds?: number; // Optional time-to-live in seconds
};

export type StateDeleteRequest = {
  key: string;
  namespace?: string;
};

export type StateGetResult<T = unknown> = {
  found: boolean;
  value?: T;
};

/**
 * State query operations (for SQL-like backends)
 */
export type StateQueryRequest = {
  query: string;
  params?: unknown[]; // Query parameters for parameterized queries
};

export type StateQueryResult = {
  rows: unknown[];
  rowCount: number;
};

/**
 * State transaction operations
 */
export type StateTransaction = {
  operations: Array<
    | { type: 'get'; request: StateGetRequest }
    | { type: 'set'; request: StateSetRequest }
    | { type: 'delete'; request: StateDeleteRequest }
    | { type: 'query'; request: StateQueryRequest }
  >;
};

export type StateTransactionResult = {
  success: boolean;
  results: Array<StateGetResult | { success: boolean } | StateQueryResult>;
  error?: string;
};

/**
 * State Port Interface
 *
 * Handlers depend on this port, not on specific implementations (Redis, PostgreSQL, DuckDB, etc.).
 * Adapters implement this port.
 */
export interface StatePort {
  /**
   * Get a value by key
   */
  get<T = unknown>(request: StateGetRequest): Promise<StateGetResult<T>>;

  /**
   * Set a value by key
   */
  set(request: StateSetRequest): Promise<{ success: boolean; error?: string }>;

  /**
   * Delete a value by key
   */
  delete(request: StateDeleteRequest): Promise<{ success: boolean; error?: string }>;

  /**
   * Execute a query (for SQL-like backends)
   */
  query(request: StateQueryRequest): Promise<StateQueryResult>;

  /**
   * Execute a transaction (atomic operations)
   */
  transaction(request: StateTransaction): Promise<StateTransactionResult>;

  /**
   * Check if state storage is available
   */
  isAvailable(): Promise<boolean>;
}
