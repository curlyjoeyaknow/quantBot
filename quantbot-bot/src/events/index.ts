/**
 * Event Bus Stub
 * ==============
 * Minimal event bus for bot service
 */

export interface Event {
  type: string;
  data: any;
  source: string;
  userId?: number;
  timestamp: Date;
}

class EventBus {
  private listeners: Map<string, Array<(event: Event) => Promise<void>>> = new Map();

  async publish(event: Event): Promise<void> {
    const listeners = this.listeners.get(event.type) || [];
    await Promise.all(listeners.map(listener => listener(event)));
  }

  subscribe(eventType: string, handler: (event: Event) => Promise<void>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(handler);
  }
}

export const eventBus = new EventBus();

export const EventFactory = {
  createUserEvent(
    type: string,
    data: any,
    source: string,
    userId?: number
  ): Event {
    return {
      type,
      data,
      source,
      userId,
      timestamp: new Date(),
    };
  },
};

