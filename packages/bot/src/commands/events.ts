/**
 * Lightweight event bus placeholder for command handlers.
 * Replace with real implementation when available.
 */

export interface UserEvent {
  type: string;
  payload: unknown;
}

export const EventFactory = {
  createUserEvent(type: string, payload: unknown): UserEvent {
    return { type, payload };
  },
};

export const eventBus = {
  async publish(_event: UserEvent): Promise<void> {
    // No-op placeholder
  },
};

