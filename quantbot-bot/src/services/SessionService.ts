/**
 * Session Service
 * ===============
 * Manages user session state for the bot.
 * Handles creation, retrieval, update, and deletion of user sessions.
 */

import { Strategy } from '../simulation/engine';
import { StopLossConfig, EntryConfig, ReEntryConfig } from '../simulation/config';
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
  }

  /**
   * Delete a user's session
   */
  deleteSession(userId: number): void {
    delete this.sessions[userId];
  }

  /**
   * Clear all sessions (useful for testing or cleanup)
   */
  clearAllSessions(): void {
    this.sessions = {};
  }

  /**
   * Get all active sessions (for monitoring/debugging)
   */
  getAllSessions(): Record<number, Session> {
    return { ...this.sessions };
  }
}
