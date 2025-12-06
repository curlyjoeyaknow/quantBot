/**
 * Lightweight event bus placeholder for command handlers.
 * Replace with real implementation when available.
 */

export interface UserEvent {
  type: string;
  payload: unknown;
  source?: string;
  userId?: number | string;
}

export const EventFactory = {
  createUserEvent(type: string, payload: unknown, source?: string, userId?: number | string): UserEvent {
    return { type, payload, source, userId };
  },
};

export const eventBus = {
  async publish(_event: UserEvent): Promise<void> {
    // No-op placeholder
  },
};

