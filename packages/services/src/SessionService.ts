/**
 * Session Service
 * ===============
 * Manages user session state for the bot.
 * Handles creation, retrieval, update, and deletion of user sessions.
 */

import { DateTime } from 'luxon';
import { Strategy } from '@quantbot/simulation';
import { StopLossConfig, EntryConfig, ReEntryConfig } from '@quantbot/simulation';
import { eventBus, EventFactory } from '../events';
import { Session as SessionType } from '../types/session';

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
    eventBus.publish(EventFactory.createUserEvent(
      'user.session.updated',
      { sessionData: session },
      'SessionService',
      userId
    ));
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
