import { describe, it, expect } from 'vitest';
import { SimpleEventEmitter, createEventEmitter } from '../../../src/core/events';
import type { SimulationEvent } from '../../../src/types';

describe('Event Emitter', () => {
  describe('SimpleEventEmitter', () => {
    it('should emit and handle events', () => {
      const emitter = new SimpleEventEmitter();
      let receivedEvent: SimulationEvent | undefined;

      emitter.on('entry', (event) => {
        receivedEvent = event;
      });

      const testEvent: SimulationEvent = {
        type: 'entry',
        timestamp: 1000,
        price: 1.0,
        description: 'Test entry',
        remainingPosition: 1.0,
        pnlSoFar: 0,
      };

      emitter.emit(testEvent);
      expect(receivedEvent).toEqual(testEvent);
    });

    it('should handle once listeners', () => {
      const emitter = new SimpleEventEmitter();
      let callCount = 0;

      emitter.once('entry', () => {
        callCount++;
      });

      const testEvent: SimulationEvent = {
        type: 'entry',
        timestamp: 1000,
        price: 1.0,
        description: 'Test',
        remainingPosition: 1.0,
        pnlSoFar: 0,
      };

      emitter.emit(testEvent);
      emitter.emit(testEvent);
      expect(callCount).toBe(1); // Should only be called once
    });

    it('should remove listeners', () => {
      const emitter = new SimpleEventEmitter();
      let callCount = 0;

      const handler = () => {
        callCount++;
      };

      emitter.on('entry', handler);
      emitter.off('entry', handler);

      const testEvent: SimulationEvent = {
        type: 'entry',
        timestamp: 1000,
        price: 1.0,
        description: 'Test',
        remainingPosition: 1.0,
        pnlSoFar: 0,
      };

      emitter.emit(testEvent);
      expect(callCount).toBe(0);
    });

    it('should get all events', () => {
      const emitter = new SimpleEventEmitter();
      const event1: SimulationEvent = {
        type: 'entry',
        timestamp: 1000,
        price: 1.0,
        description: 'Test 1',
        remainingPosition: 1.0,
        pnlSoFar: 0,
      };
      const event2: SimulationEvent = {
        type: 'target_hit',
        timestamp: 2000,
        price: 2.0,
        description: 'Test 2',
        remainingPosition: 0.5,
        pnlSoFar: 0.5,
      };

      emitter.emit(event1);
      emitter.emit(event2);

      const events = emitter.getEvents();
      expect(events.length).toBe(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
    });
  });

  describe('createEventEmitter', () => {
    it('should create a new event emitter', () => {
      const emitter = createEventEmitter();
      expect(emitter).toBeInstanceOf(SimpleEventEmitter);
    });
  });
});
