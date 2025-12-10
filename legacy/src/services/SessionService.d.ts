/**
 * Session Service
 * ===============
 * Manages user session state for the bot.
 * Handles creation, retrieval, update, and deletion of user sessions.
 */
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
export declare class SessionService {
    private sessions;
    /**
     * Get a user's session
     */
    getSession(userId: number): Session | undefined;
    /**
     * Get or create a session for a user
     */
    getOrCreateSession(userId: number, initialData?: Partial<Session>): Session;
    /**
     * Set/update a user's session
     */
    setSession(userId: number, session: Session): void;
    /**
     * Update specific fields in a user's session
     */
    updateSession(userId: number, updates: Partial<Session>): void;
    /**
     * Clear a user's session
     */
    clearSession(userId: number): void;
    /**
     * Get all active sessions (useful for debugging/administration)
     */
    getAllSessions(): Record<number, Session>;
    /**
     * Clear all sessions (use with caution)
     */
    clearAllSessions(): void;
    /**
     * Check if a user has an active session
     */
    hasSession(userId: number): boolean;
    /**
     * Get the count of active sessions
     */
    getActiveSessionCount(): number;
}
export declare const sessionService: SessionService;
//# sourceMappingURL=SessionService.d.ts.map