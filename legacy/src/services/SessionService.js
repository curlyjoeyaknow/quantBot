"use strict";
/**
 * Session Service
 * ===============
 * Manages user session state for the bot.
 * Handles creation, retrieval, update, and deletion of user sessions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionService = exports.SessionService = void 0;
const events_1 = require("../events");
/**
 * In-memory session storage implementation
 * In production, this could be backed by Redis or a database
 */
class SessionService {
    constructor() {
        this.sessions = {};
    }
    /**
     * Get a user's session
     */
    getSession(userId) {
        return this.sessions[userId];
    }
    /**
     * Get or create a session for a user
     */
    getOrCreateSession(userId, initialData) {
        if (!this.sessions[userId]) {
            this.sessions[userId] = { ...initialData };
        }
        return this.sessions[userId];
    }
    /**
     * Set/update a user's session
     */
    setSession(userId, session) {
        this.sessions[userId] = session;
        // Emit session updated event
        events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.session.updated', { sessionData: session }, 'SessionService', userId));
    }
    /**
     * Update specific fields in a user's session
     */
    updateSession(userId, updates) {
        if (!this.sessions[userId]) {
            this.sessions[userId] = {};
        }
        this.sessions[userId] = { ...this.sessions[userId], ...updates };
    }
    /**
     * Clear a user's session
     */
    clearSession(userId) {
        delete this.sessions[userId];
    }
    /**
     * Get all active sessions (useful for debugging/administration)
     */
    getAllSessions() {
        return { ...this.sessions };
    }
    /**
     * Clear all sessions (use with caution)
     */
    clearAllSessions() {
        this.sessions = {};
    }
    /**
     * Check if a user has an active session
     */
    hasSession(userId) {
        return userId in this.sessions;
    }
    /**
     * Get the count of active sessions
     */
    getActiveSessionCount() {
        return Object.keys(this.sessions).length;
    }
}
exports.SessionService = SessionService;
// Export singleton instance
exports.sessionService = new SessionService();
//# sourceMappingURL=SessionService.js.map