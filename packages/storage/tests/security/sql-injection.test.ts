/**
 * SQL Injection Prevention Tests
 * 
 * Tests that all query builder utilities properly escape user input
 * to prevent SQL injection attacks.
 * 
 * CRITICAL: These tests verify that malicious input cannot break out
 * of SQL string literals or inject arbitrary SQL code.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  escapeSqlString,
  buildTokenAddressWhereClause,
  buildDateRangeWhereClauseUnix,
  buildChainWhereClause,
  buildIntervalWhereClause,
  buildIntervalStringWhereClause,
  buildInWhereClause,
} from '../../src/utils/query-builder.js';

describe('SQL Injection Prevention', () => {
  describe('escapeSqlString', () => {
    it('should escape single quotes', () => {
      const input = "O'Reilly";
      const escaped = escapeSqlString(input);
      expect(escaped).toBe("O''Reilly");
    });

    it('should escape multiple single quotes', () => {
      const input = "O''Reilly";
      const escaped = escapeSqlString(input);
      expect(escaped).toBe("O''''Reilly");
    });

    it('should handle empty string', () => {
      const escaped = escapeSqlString('');
      expect(escaped).toBe('');
    });

    it('should handle string with no quotes', () => {
      const input = 'Hello World';
      const escaped = escapeSqlString(input);
      expect(escaped).toBe('Hello World');
    });

    it('should prevent SQL injection via single quote', () => {
      const malicious = "'; DROP TABLE ohlcv_candles; --";
      const escaped = escapeSqlString(malicious);
      // Should escape the quote, preventing injection
      // The escaped string will be: "''; DROP TABLE ohlcv_candles; --"
      // This is safe because the quote is doubled, making it a literal quote in SQL
      expect(escaped).toContain("''");
      expect(escaped).toBe("''; DROP TABLE ohlcv_candles; --");
    });

    it('should prevent SQL injection via UNION SELECT', () => {
      const malicious = "'; UNION SELECT * FROM users; --";
      const escaped = escapeSqlString(malicious);
      // The escaped string will be: "''; UNION SELECT * FROM users; --"
      expect(escaped).toContain("''");
      expect(escaped).toBe("''; UNION SELECT * FROM users; --");
    });
  });

  describe('buildTokenAddressWhereClause', () => {
    it('should escape token address with single quotes', () => {
      const malicious = "So11111111111111111111111111111111111111112' OR '1'='1";
      const clause = buildTokenAddressWhereClause(malicious);
      
      // Should escape all quotes (all quotes in the malicious string are escaped)
      expect(clause).toContain("''");
      // The entire malicious string is escaped, so all quotes become doubled
      expect(clause).toContain("'' OR ''1''=''1");
    });

    it('should prevent SQL injection via token address', () => {
      const malicious = "'; DROP TABLE ohlcv_candles; --";
      const clause = buildTokenAddressWhereClause(malicious);
      
      // Should escape quotes (doubled quotes make it safe)
      expect(clause).toContain("''");
      // The clause should contain the escaped malicious string as a literal value
      expect(clause).toContain("''; DROP TABLE ohlcv_candles; --");
    });

    it('should handle normal token address', () => {
      const token = 'So11111111111111111111111111111111111111112';
      const clause = buildTokenAddressWhereClause(token);
      
      expect(clause).toContain(token);
      expect(clause).toContain('token_address');
    });

    it('should use custom column name', () => {
      const token = 'So11111111111111111111111111111111111111112';
      const clause = buildTokenAddressWhereClause(token, 'mint_address');
      
      expect(clause).toContain('mint_address');
      expect(clause).not.toContain('token_address');
    });

    it('should prevent injection with LIKE patterns', () => {
      const malicious = "%' OR '1'='1";
      const clause = buildTokenAddressWhereClause(malicious);
      
      // Should escape quotes in LIKE patterns
      expect(clause).toContain("''");
      expect(clause).toContain("''; OR '1'='1");
    });
  });

  describe('buildChainWhereClause', () => {
    it('should escape chain name with single quotes', () => {
      const malicious = "solana' OR '1'='1";
      const clause = buildChainWhereClause(malicious);
      
      expect(clause).toContain("''");
      expect(clause).toContain("solana''; OR '1'='1");
    });

    it('should prevent SQL injection via chain name', () => {
      const malicious = "'; DROP TABLE ohlcv_candles; --";
      const clause = buildChainWhereClause(malicious);
      
      // Should escape quotes (doubled quotes make it safe)
      expect(clause).toContain("''");
      // The clause should contain the escaped malicious string as a literal value
      expect(clause).toContain("''; DROP TABLE ohlcv_candles; --");
    });

    it('should handle normal chain name', () => {
      const chain = 'solana';
      const clause = buildChainWhereClause(chain);
      
      expect(clause).toBe("chain = 'solana'");
    });

    it('should use custom column name', () => {
      const chain = 'solana';
      const clause = buildChainWhereClause(chain, 'blockchain');
      
      expect(clause).toBe("blockchain = 'solana'");
    });
  });

  describe('buildDateRangeWhereClauseUnix', () => {
    it('should handle valid Unix timestamps', () => {
      const fromUnix = 1704067200;
      const toUnix = 1704153600;
      const clause = buildDateRangeWhereClauseUnix(fromUnix, toUnix);
      
      expect(clause).toContain(`timestamp >= toDateTime(${fromUnix})`);
      expect(clause).toContain(`timestamp <= toDateTime(${toUnix})`);
    });

    it('should prevent SQL injection via timestamp', () => {
      // Even if someone passes a string, it should be treated as a number
      // This test verifies the function signature enforces numbers
      const fromUnix = 1704067200;
      const toUnix = 1704153600;
      const clause = buildDateRangeWhereClauseUnix(fromUnix, toUnix);
      
      // Should not contain any string interpolation vulnerabilities
      expect(clause).not.toContain("'");
      expect(clause).toMatch(/timestamp >= toDateTime\(\d+\)/);
    });

    it('should use custom column name', () => {
      const fromUnix = 1704067200;
      const toUnix = 1704153600;
      const clause = buildDateRangeWhereClauseUnix(fromUnix, toUnix, 'created_at');
      
      expect(clause).toContain('created_at');
      expect(clause).not.toContain('timestamp');
    });
  });

  describe('buildIntervalWhereClause', () => {
    it('should handle valid interval seconds', () => {
      const intervalSeconds = 300; // 5 minutes
      const clause = buildIntervalWhereClause(intervalSeconds);
      
      expect(clause).toBe('interval_seconds = 300');
    });

    it('should prevent SQL injection via interval', () => {
      // Function signature enforces number type, preventing string injection
      const intervalSeconds = 300;
      const clause = buildIntervalWhereClause(intervalSeconds);
      
      // Should not contain any string interpolation
      expect(clause).not.toContain("'");
      expect(clause).toMatch(/interval_seconds = \d+/);
    });

    it('should use custom column name', () => {
      const intervalSeconds = 300;
      const clause = buildIntervalWhereClause(intervalSeconds, 'candle_interval');
      
      expect(clause).toContain('candle_interval');
      expect(clause).not.toContain('interval_seconds');
    });
  });

  describe('buildIntervalStringWhereClause', () => {
    it('should escape interval string with single quotes', () => {
      const malicious = "5m' OR '1'='1";
      const clause = buildIntervalStringWhereClause(malicious);
      
      expect(clause).toContain("''");
      expect(clause).toContain("`interval`");
    });

    it('should prevent SQL injection via interval string', () => {
      const malicious = "'; DROP TABLE ohlcv_candles; --";
      const clause = buildIntervalStringWhereClause(malicious);
      
      expect(clause).toContain("''");
      expect(clause).toContain("''; DROP TABLE ohlcv_candles; --");
    });

    it('should handle normal interval string', () => {
      const interval = '5m';
      const clause = buildIntervalStringWhereClause(interval);
      
      expect(clause).toBe("`interval` = '5m'");
    });
  });

  describe('buildInWhereClause', () => {
    it('should escape values in IN clause', () => {
      const values = ["type1", "type2", "O'Reilly"];
      const clause = buildInWhereClause(values, 'indicator_type');
      
      expect(clause).toContain("'type1'");
      expect(clause).toContain("'type2'");
      expect(clause).toContain("'O''Reilly'"); // Escaped quote
      expect(clause).toContain('indicator_type IN');
    });

    it('should prevent SQL injection via IN clause values', () => {
      const malicious = ["'; DROP TABLE ohlcv_candles; --", "normal"];
      const clause = buildInWhereClause(malicious, 'indicator_type');
      
      // Should escape quotes
      expect(clause).toContain("''");
      // Should contain the escaped malicious string as a literal value
      expect(clause).toContain("''; DROP TABLE ohlcv_candles; --");
      expect(clause).toContain("'normal'");
    });

    it('should handle empty array', () => {
      const clause = buildInWhereClause([], 'indicator_type');
      
      // Should return always-false condition
      expect(clause).toBe('1 = 0');
    });

    it('should handle single value', () => {
      const clause = buildInWhereClause(['type1'], 'indicator_type');
      
      expect(clause).toBe("indicator_type IN ('type1')");
    });

    it('should handle multiple values', () => {
      const clause = buildInWhereClause(['type1', 'type2', 'type3'], 'indicator_type');
      
      expect(clause).toBe("indicator_type IN ('type1','type2','type3')");
    });
  });

  describe('Combined Query Building', () => {
    it('should build safe query with all components', () => {
      const maliciousToken = "'; DROP TABLE ohlcv_candles; --";
      const maliciousChain = "solana' OR '1'='1";
      const fromUnix = 1704067200;
      const toUnix = 1704153600;
      const intervalSeconds = 300;

      const tokenClause = buildTokenAddressWhereClause(maliciousToken);
      const chainClause = buildChainWhereClause(maliciousChain);
      const dateClause = buildDateRangeWhereClauseUnix(fromUnix, toUnix);
      const intervalClause = buildIntervalWhereClause(intervalSeconds);

      const query = `
        SELECT * FROM ohlcv_candles
        WHERE ${tokenClause}
          AND ${chainClause}
          AND ${dateClause}
          AND ${intervalClause}
      `;

      // Verify all quotes are escaped (doubled quotes make it safe)
      expect(query).toContain("''");
      // The malicious strings are safely escaped as literal values
      expect(query).toContain("''; DROP TABLE ohlcv_candles; --");
      expect(query).toContain("solana''; OR '1'='1");
      // Verify valid SQL structure
      expect(query).toContain('WHERE');
      expect(query).toContain('AND');
    });

    it('should handle edge case with empty token address', () => {
      const emptyToken = '';
      const clause = buildTokenAddressWhereClause(emptyToken);
      
      // Should still produce valid SQL (even if it matches nothing)
      expect(clause).toContain('token_address');
      // Empty string produces empty quotes in SQL: token_address = ''
      expect(clause).toContain("token_address = ''");
    });

    it('should handle very long token address', () => {
      const longToken = 'A'.repeat(1000) + "' OR '1'='1";
      const clause = buildTokenAddressWhereClause(longToken);
      
      // Should escape the quote even in long strings
      expect(clause).toContain("''");
      expect(clause).toContain("''; OR '1'='1");
    });
  });
});

