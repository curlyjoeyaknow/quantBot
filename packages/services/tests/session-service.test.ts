import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from '../../src/services/SessionService';
import { eventBus, EventFactory } from '../../src/events';

// Mock eventBus
vi.mock('../../src/events', () => ({
  eventBus: {
    publish: vi.fn(),
  },
  EventFactory: {
    createUserEvent: vi.fn((type, data, source, userId) => ({
      type,
      data,
      source,
      userId,
    })),
  },
}));

describe('session-service', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
    vi.clearAllMocks();
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      const session = service.getSession(123);
      expect(session).toBeUndefined();
    });

    it('should return existing session', () => {
      const testSession = { type: 'backtest', step: 'waiting_for_token' };
      service.setSession(123, testSession as any);

      const session = service.getSession(123);
      expect(session).toEqual(testSession);
    });
  });

  describe('getOrCreateSession', () => {
    it('should create new session when none exists', () => {
      const initialData = { type: 'backtest' };
      const session = service.getOrCreateSession(123, initialData as any);

      expect(session).toBeDefined();
      expect(session.type).toBe('backtest');
    });

    it('should return existing session when it exists', () => {
      const existingSession = { type: 'backtest', step: 'waiting_for_token' };
      service.setSession(123, existingSession as any);

      const session = service.getOrCreateSession(123);
      expect(session).toEqual(existingSession);
    });
  });

  describe('setSession', () => {
    it('should set session and emit event', () => {
      const testSession = { type: 'backtest', step: 'waiting_for_token' };
      service.setSession(123, testSession as any);

      expect(service.getSession(123)).toEqual(testSession);
      expect(eventBus.publish).toHaveBeenCalled();
    });
  });

  describe('updateSession', () => {
    it('should update existing session', () => {
      const initialSession = { type: 'backtest', step: 'waiting_for_token' };
      service.setSession(123, initialSession as any);

      service.updateSession(123, { step: 'waiting_for_strategy' } as any);

      const updated = service.getSession(123);
      expect(updated?.step).toBe('waiting_for_strategy');
    });

    it('should create session if it does not exist', () => {
      service.updateSession(123, { type: 'backtest' } as any);

      const session = service.getSession(123);
      expect(session).toBeDefined();
      expect(session?.type).toBe('backtest');
    });
  });

  describe('clearSession', () => {
    it('should remove session', () => {
      service.setSession(123, { type: 'backtest' } as any);
      service.clearSession(123);

      expect(service.getSession(123)).toBeUndefined();
    });

    it('should handle clearing non-existent session', () => {
      expect(() => service.clearSession(999)).not.toThrow();
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions', () => {
      service.setSession(123, { type: 'backtest' } as any);
      service.setSession(456, { type: 'ichimoku' } as any);

      const all = service.getAllSessions();
      expect(Object.keys(all)).toHaveLength(2);
    });

    it('should return empty object when no sessions', () => {
      const all = service.getAllSessions();
      expect(Object.keys(all)).toHaveLength(0);
    });
  });

  describe('clearAllSessions', () => {
    it('should clear all sessions', () => {
      service.setSession(123, { type: 'backtest' } as any);
      service.setSession(456, { type: 'ichimoku' } as any);

      service.clearAllSessions();

      expect(service.getSession(123)).toBeUndefined();
      expect(service.getSession(456)).toBeUndefined();
    });
  });

  describe('hasSession', () => {
    it('should return true for existing session', () => {
      service.setSession(123, { type: 'backtest' } as any);
      expect(service.hasSession(123)).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(service.hasSession(999)).toBe(false);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return correct count', () => {
      expect(service.getActiveSessionCount()).toBe(0);

      service.setSession(123, { type: 'backtest' } as any);
      expect(service.getActiveSessionCount()).toBe(1);

      service.setSession(456, { type: 'ichimoku' } as any);
      expect(service.getActiveSessionCount()).toBe(2);

      service.clearSession(123);
      expect(service.getActiveSessionCount()).toBe(1);
    });
  });
});


