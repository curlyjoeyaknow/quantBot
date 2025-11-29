/**
 * @file SessionService.test.ts
 * @description
 * Comprehensive unit tests for SessionService covering CRUD operations,
 * state management, edge cases, and bulk operations.
 */

import { SessionService, Session } from '../../src/services/SessionService';
import { DateTime } from 'luxon';

describe('SessionService', () => {
  let sessionService: SessionService;

  beforeEach(() => {
    sessionService = new SessionService();
  });

  afterEach(() => {
    sessionService.clearAllSessions();
  });

  describe('Session CRUD Operations', () => {
    it('should create and retrieve a session', () => {
      const userId = 12345;
      const session: Session = {
        step: 'waiting_for_token',
        type: 'backtest',
        mint: 'test-mint',
        chain: 'solana'
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved).toEqual(session);
      expect(retrieved?.step).toBe('waiting_for_token');
      expect(retrieved?.type).toBe('backtest');
      expect(retrieved?.mint).toBe('test-mint');
      expect(retrieved?.chain).toBe('solana');
    });

    it('should update an existing session', () => {
      const userId = 12345;
      const initialSession: Session = {
        step: 'waiting_for_token',
        type: 'backtest'
      };

      sessionService.setSession(userId, initialSession);

      const updatedSession: Session = {
        ...initialSession,
        mint: 'updated-mint',
        chain: 'ethereum'
      };

      sessionService.setSession(userId, updatedSession);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved).toEqual(updatedSession);
      expect(retrieved?.mint).toBe('updated-mint');
      expect(retrieved?.chain).toBe('ethereum');
    });

    it('should delete a session', () => {
      const userId = 12345;
      const session: Session = {
        step: 'waiting_for_token',
        type: 'backtest'
      };

      sessionService.setSession(userId, session);
      expect(sessionService.hasSession(userId)).toBe(true);

      sessionService.clearSession(userId);
      expect(sessionService.hasSession(userId)).toBe(false);
      expect(sessionService.getSession(userId)).toBeUndefined();
    });

    it('should return undefined for non-existent session', () => {
      const userId = 99999;
      const retrieved = sessionService.getSession(userId);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Get or Create Session', () => {
    it('should create new session when none exists', () => {
      const userId = 12345;
      const initialData: Partial<Session> = {
        step: 'waiting_for_token',
        type: 'backtest'
      };

      const session = sessionService.getOrCreateSession(userId, initialData);

      expect(session).toEqual(initialData);
      expect(sessionService.hasSession(userId)).toBe(true);
    });

    it('should return existing session when one exists', () => {
      const userId = 12345;
      const existingSession: Session = {
        step: 'waiting_for_token',
        type: 'backtest',
        mint: 'existing-mint'
      };

      sessionService.setSession(userId, existingSession);

      const session = sessionService.getOrCreateSession(userId, { step: 'new_step' });

      expect(session).toEqual(existingSession);
      expect(session?.mint).toBe('existing-mint');
    });

    it('should create empty session when no initial data provided', () => {
      const userId = 12345;
      const session = sessionService.getOrCreateSession(userId);

      expect(session).toEqual({});
      expect(sessionService.hasSession(userId)).toBe(true);
    });
  });

  describe('Session State Management', () => {
    it('should handle multiple concurrent sessions', () => {
      const user1 = 12345;
      const user2 = 67890;
      const user3 = 11111;

      const session1: Session = { step: 'waiting_for_token', type: 'backtest' };
      const session2: Session = { step: 'waiting_for_datetime', type: 'ichimoku' };
      const session3: Session = { step: 'waiting_for_strategy', type: 'backtest' };

      sessionService.setSession(user1, session1);
      sessionService.setSession(user2, session2);
      sessionService.setSession(user3, session3);

      expect(sessionService.getSession(user1)).toEqual(session1);
      expect(sessionService.getSession(user2)).toEqual(session2);
      expect(sessionService.getSession(user3)).toEqual(session3);
      expect(sessionService.getActiveSessionCount()).toBe(3);
    });

    it('should maintain session data integrity', () => {
      const userId = 12345;
      const complexSession: Session = {
        step: 'waiting_for_strategy',
        type: 'backtest',
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        datetime: DateTime.utc(),
        metadata: {
          name: 'Test Token',
          symbol: 'TEST',
          price: 1.5,
          marketCap: 1000000
        },
        strategy: [
          { percent: 0.5, target: 2 },
          { percent: 0.3, target: 5 },
          { percent: 0.2, target: 10 }
        ],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        entryConfig: { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 },
        reEntryConfig: { trailingReEntry: 'none', maxReEntries: 0 }
      };

      sessionService.setSession(userId, complexSession);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved).toEqual(complexSession);
      expect(retrieved?.metadata?.name).toBe('Test Token');
      expect(retrieved?.strategy).toHaveLength(3);
      expect(retrieved?.datetime).toBeInstanceOf(DateTime);
    });

    it('should handle partial updates correctly', () => {
      const userId = 12345;
      const initialSession: Session = {
        step: 'waiting_for_token',
        type: 'backtest',
        mint: 'initial-mint'
      };

      sessionService.setSession(userId, initialSession);

      // Update only specific fields
      sessionService.updateSession(userId, { 
        step: 'waiting_for_datetime',
        chain: 'ethereum'
      });

      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.step).toBe('waiting_for_datetime');
      expect(retrieved?.type).toBe('backtest'); // Should remain unchanged
      expect(retrieved?.mint).toBe('initial-mint'); // Should remain unchanged
      expect(retrieved?.chain).toBe('ethereum'); // Should be updated
    });

    it('should create session if updating non-existent session', () => {
      const userId = 12345;
      
      sessionService.updateSession(userId, { step: 'waiting_for_token' });

      const retrieved = sessionService.getSession(userId);
      expect(retrieved?.step).toBe('waiting_for_token');
      expect(sessionService.hasSession(userId)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', () => {
      const userId = 12345;
      const sessionWithNulls: Session = {
        step: undefined,
        type: 'backtest',
        data: undefined,
        metadata: undefined
      };

      sessionService.setSession(userId, sessionWithNulls);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.step).toBeUndefined();
      expect(retrieved?.type).toBe('backtest');
      expect(retrieved?.data).toBeNull();
      expect(retrieved?.metadata).toBeUndefined();
    });

    it('should handle large session data', () => {
      const userId = 12345;
      const largeMetadata = {
        name: 'A'.repeat(1000),
        symbol: 'B'.repeat(100),
        description: 'C'.repeat(5000),
        tags: Array(100).fill('tag').map((tag, i) => `${tag}-${i}`),
        extraData: {
          nested: {
            deep: {
              value: 'deeply nested value',
              array: Array(50).fill('item')
            }
          }
        }
      };

      const session: Session = {
        step: 'waiting_for_token',
        type: 'backtest',
        metadata: largeMetadata
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.metadata?.name).toHaveLength(1000);
      // Note: TokenMetadata doesn't have tags or extraData - these are test-specific extensions
      expect((retrieved?.metadata as any)?.tags).toHaveLength(100);
      expect((retrieved?.metadata as any)?.extraData?.nested?.deep?.array).toHaveLength(50);
    });

    it('should handle zero and negative user IDs', () => {
      const userIds = [0, -1, -999];
      
      userIds.forEach((userId, index) => {
        const session: Session = {
          step: `step_${index}`,
          type: 'backtest'
        };
        
        sessionService.setSession(userId, session);
        expect(sessionService.hasSession(userId)).toBe(true);
        expect(sessionService.getSession(userId)?.step).toBe(`step_${index}`);
      });

      expect(sessionService.getActiveSessionCount()).toBe(3);
    });

    it('should handle very large user IDs', () => {
      const userId = Number.MAX_SAFE_INTEGER;
      const session: Session = {
        step: 'waiting_for_token',
        type: 'backtest'
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved).toEqual(session);
      expect(sessionService.hasSession(userId)).toBe(true);
    });
  });

  describe('Bulk Operations', () => {
    it('should get all sessions', () => {
      const sessions = {
        12345: { step: 'waiting_for_token', type: 'backtest' },
        67890: { step: 'waiting_for_datetime', type: 'ichimoku' },
        11111: { step: 'waiting_for_strategy', type: 'backtest' }
      };

      Object.entries(sessions).forEach(([userId, session]) => {
        sessionService.setSession(parseInt(userId), session);
      });

      const allSessions = sessionService.getAllSessions();

      expect(Object.keys(allSessions)).toHaveLength(3);
      expect(allSessions[12345]).toEqual(sessions[12345]);
      expect(allSessions[67890]).toEqual(sessions[67890]);
      expect(allSessions[11111]).toEqual(sessions[11111]);
    });

    it('should return empty object when no sessions exist', () => {
      const allSessions = sessionService.getAllSessions();
      expect(allSessions).toEqual({});
    });

    it('should clear all sessions', () => {
      const userIds = [12345, 67890, 11111];
      
      userIds.forEach(userId => {
        sessionService.setSession(userId, { step: 'test', type: 'backtest' });
      });

      expect(sessionService.getActiveSessionCount()).toBe(3);

      sessionService.clearAllSessions();

      expect(sessionService.getActiveSessionCount()).toBe(0);
      userIds.forEach(userId => {
        expect(sessionService.hasSession(userId)).toBe(false);
      });
    });

    it('should handle clearing all sessions when none exist', () => {
      expect(sessionService.getActiveSessionCount()).toBe(0);
      
      sessionService.clearAllSessions();
      
      expect(sessionService.getActiveSessionCount()).toBe(0);
    });
  });

  describe('Session Count Tracking', () => {
    it('should track active session count correctly', () => {
      expect(sessionService.getActiveSessionCount()).toBe(0);

      sessionService.setSession(12345, { step: 'test1' });
      expect(sessionService.getActiveSessionCount()).toBe(1);

      sessionService.setSession(67890, { step: 'test2' });
      expect(sessionService.getActiveSessionCount()).toBe(2);

      sessionService.clearSession(12345);
      expect(sessionService.getActiveSessionCount()).toBe(1);

      sessionService.clearSession(67890);
      expect(sessionService.getActiveSessionCount()).toBe(0);
    });

    it('should not increment count when updating existing session', () => {
      const userId = 12345;
      
      sessionService.setSession(userId, { step: 'test1' });
      expect(sessionService.getActiveSessionCount()).toBe(1);

      sessionService.setSession(userId, { step: 'test2' });
      expect(sessionService.getActiveSessionCount()).toBe(1);

      sessionService.updateSession(userId, { step: 'test3' });
      expect(sessionService.getActiveSessionCount()).toBe(1);
    });
  });

  describe('Session Existence Checks', () => {
    it('should correctly identify session existence', () => {
      const userId = 12345;
      
      expect(sessionService.hasSession(userId)).toBe(false);

      sessionService.setSession(userId, { step: 'test' });
      expect(sessionService.hasSession(userId)).toBe(true);

      sessionService.clearSession(userId);
      expect(sessionService.hasSession(userId)).toBe(false);
    });

    it('should handle existence check for non-existent user', () => {
      expect(sessionService.hasSession(99999)).toBe(false);
    });
  });

  describe('Session Data Types', () => {
    it('should handle DateTime objects correctly', () => {
      const userId = 12345;
      const now = DateTime.utc();
      const session: Session = {
        step: 'waiting_for_datetime',
        datetime: now,
        lastSimulation: {
          mint: 'test-mint',
          chain: 'solana',
          datetime: now.minus({ hours: 1 }),
          metadata: { name: 'Test', symbol: 'TEST' },
          candles: []
        }
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.datetime).toBeInstanceOf(DateTime);
      expect(retrieved?.datetime?.toISO()).toBe(now.toISO());
      expect(retrieved?.lastSimulation?.datetime).toBeInstanceOf(DateTime);
    });

    it('should handle strategy arrays correctly', () => {
      const userId = 12345;
      const strategy = [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ];
      const session: Session = {
        step: 'waiting_for_strategy',
        strategy
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.strategy).toEqual(strategy);
      expect(retrieved?.strategy).toHaveLength(3);
      expect(retrieved?.strategy?.[0]).toEqual({ percent: 0.5, target: 2 });
    });

    it('should handle complex nested objects', () => {
      const userId = 12345;
      const complexData = {
        level1: {
          level2: {
            level3: {
              value: 'deep value',
              array: [1, 2, 3],
              nested: {
                final: true
              }
            }
          }
        }
      };
      const session: Session = {
        step: 'waiting_for_data',
        data: complexData
      };

      sessionService.setSession(userId, session);
      const retrieved = sessionService.getSession(userId);

      expect(retrieved?.data).toEqual(complexData);
      expect((retrieved?.data as any)?.level1?.level2?.level3?.value).toBe('deep value');
      expect((retrieved?.data as any)?.level1?.level2?.level3?.array).toEqual([1, 2, 3]);
      expect((retrieved?.data as any)?.level1?.level2?.level3?.nested?.final).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session data gracefully', () => {
      const userId = 12345;
      
      // Test with circular reference (should be handled by JSON serialization)
      const circularData: any = { name: 'test' };
      circularData.self = circularData;
      
      const session: Session = {
        step: 'test',
        data: circularData
      };

      // This should not throw an error
      expect(() => {
        sessionService.setSession(userId, session);
      }).not.toThrow();
    });

    it('should handle undefined user ID gracefully', () => {
      // TypeScript should prevent this, but test runtime behavior
      const session: Session = { step: 'test' };
      
      expect(() => {
        // @ts-ignore - Testing runtime behavior
        sessionService.setSession(undefined, session);
      }).not.toThrow();
    });
  });
});
