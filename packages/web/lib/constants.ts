// Application constants

export const CONSTANTS = {
  // Time periods
  DAYS_7_MS: 7 * 24 * 60 * 60 * 1000,
  DAYS_1_MS: 24 * 60 * 60 * 1000,
  HOURS_6_MS: 6 * 60 * 60 * 1000,
  
  // Cache TTLs (in seconds)
  CACHE_TTL: {
    OHLCV: 3600, // 1 hour
    CURRENT_PRICE: 300, // 5 minutes
    MARKET_CAP: 3600, // 1 hour
    DASHBOARD: 900, // 15 minutes
    CALLER_STATS: 1800, // 30 minutes
    RECENT_ALERTS: 300, // 5 minutes
  },
  
  // API limits
  BIRDEYE_RATE_LIMIT: {
    REQUESTS_PER_SECOND: 10,
    BATCH_SIZE: 50,
  },
  
  // ClickHouse limits
  CLICKHOUSE: {
    MAX_CONCURRENT_QUERIES: 5,
    QUERY_TIMEOUT_MS: 30000, // 30 seconds
  },
  
  // Request limits
  REQUEST: {
    MAX_TIMEOUT_MS: 30000, // 30 seconds
    MAX_PAGE_SIZE: 500,
    DEFAULT_PAGE_SIZE: 50,
  },
  
  // Market cap calculation
  MARKET_CAP: {
    PUMP_FUN_SUPPLY: 1_000_000_000, // 1 billion
  },
  
  // Strategy parameters
  STRATEGY: {
    LOSS_CAP_PERCENT: 0.2, // 20%
    MIN_PNL: 0.8, // 0.8x = -20% max loss
    SIX_HOUR_MARK_MS: 6 * 60 * 60 * 1000,
  },
  
  // Front-end constants
  FRONTEND: {
    // Pagination
    DEFAULT_PAGE_SIZE: 50,
    RECENT_ALERTS_PAGE_SIZE: 100,
    
    // Refresh intervals (milliseconds)
    CONTROL_PANEL_REFRESH_INTERVAL: 10000, // 10 seconds
    HEALTH_REFRESH_INTERVAL: 30000, // 30 seconds
    RECORDING_REFRESH_INTERVAL: 30000, // 30 seconds
    
    // API timeouts
    API_TIMEOUT: 30000, // 30 seconds
    
    // Retry configuration
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // 1 second
  },
} as const;

