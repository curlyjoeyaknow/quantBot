/**
 * Session Service
 * ===============
 * Manages user session state for the bot.
 * Handles creation, retrieval, update, and deletion of user sessions.
 */

import { DateTime } from 'luxon';
import { Strategy } from '@quantbot/simulation';
import { StopLossConfig, EntryConfig, ReEntryConfig } from '@quantbot/simulation';
// TODO: Events module needs to be in this package or utils
// import { eventBus, EventFactory } from './events';

// Temporary stubs until events module is available
const eventBus = { 
  emit: (event: string, data: any) => {},
  publish: (event: any) => {} // Add publish method
};
const EventFactory = { 
  sessionCreated: (data: any) => ({ type: 'session_created', data }),
  sessionUpdated: (data: any) => ({ type: 'session_updated', data }),
  sessionCleared: (data: any) => ({ type: 'session_cleared', data }),
  createUserEvent: (type: string, userId: number, data: any) => ({ type, userId, data })
};

// Session type from utils
import type { SimulationRunData } from '@quantbot/utils';

// TODO: Define proper Session type
type SessionType = any;

/**
 * Session data structure for maintaining user state
 * Re-export from types/session.ts for consistency
 */
export type Session = SessionType;

/**
 * In-memory session storage implementation
 * In production, this could be backed by Redis or a database
 */
export class SessionService {
  private sessions: Record<number, Session> = {};

  /**
   * Get a user's session
   */
  getSession(userId: number): Session | undefined {
    return this.sessions[userId];
  }

  /**
   * Get or create a session for a user
   */
  getOrCreateSession(userId: number, initialData?: Partial<Session>): Session {
    if (!this.sessions[userId]) {
      this.sessions[userId] = { ...initialData };
    }
    return this.sessions[userId];
  }

  /**
   * Set/update a user's session
   */
  setSession(userId: number, session: Session): void {
    this.sessions[userId] = session;
    
    // Emit session updated event
    eventBus.publish(
      EventFactory.createUserEvent('user.session.updated', userId, { sessionData: session })
    );
  }

  /**
   * Update specific fields in a user's session
   */
  updateSession(userId: number, updates: Partial<Session>): void {
    if (!this.sessions[userId]) {
      this.sessions[userId] = {};
    }
    this.sessions[userId] = { ...this.sessions[userId], ...updates };
  }

  /**
   * Clear a user's session
   */
  clearSession(userId: number): void {
    delete this.sessions[userId];
  }

  /**
   * Get all active sessions (useful for debugging/administration)
   */
  getAllSessions(): Record<number, Session> {
    return { ...this.sessions };
  }

  /**
   * Clear all sessions (use with caution)
   */
  clearAllSessions(): void {
    this.sessions = {};
  }

  /**
   * Check if a user has an active session
   */
  hasSession(userId: number): boolean {
    return userId in this.sessions;
  }

  /**
   * Get the count of active sessions
   */
  getActiveSessionCount(): number {
    return Object.keys(this.sessions).length;
  }
}

// Export singleton instance
export const sessionService = new SessionService();
