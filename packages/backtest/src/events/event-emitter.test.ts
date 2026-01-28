/**
 * Unit tests for event emitter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from './event-emitter.js';
import { PythonEngine } from '@quantbot/utils';

describe('EventEmitter', () => {
  let mockPythonEngine: PythonEngine;
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    mockPythonEngine = {
      runScript: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as PythonEngine;
    eventEmitter = new EventEmitter(mockPythonEngine);
  });

  it('should emit run.created event', async () => {
    await eventEmitter.emitRunCreated('run-123', 'baseline', { key: 'value' }, 'fp1');

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('emit_event.py'),
      expect.objectContaining({
        'event-type': 'run.created',
        'run-id': 'run-123',
        'run-type': 'baseline',
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should emit run.started event', async () => {
    await eventEmitter.emitRunStarted('run-123');

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('emit_event.py'),
      expect.objectContaining({
        'event-type': 'run.started',
        'run-id': 'run-123',
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should emit run.completed event', async () => {
    await eventEmitter.emitRunCompleted('run-123', { status: 'done' }, { artifact: 'path' });

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('emit_event.py'),
      expect.objectContaining({
        'event-type': 'run.completed',
        'run-id': 'run-123',
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should emit phase.started event', async () => {
    await eventEmitter.emitPhaseStarted('run-123', 'plan', 0);

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('emit_event.py'),
      expect.objectContaining({
        'event-type': 'phase.started',
        'run-id': 'run-123',
        'phase-name': 'plan',
        'phase-order': 0,
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should emit phase.completed event', async () => {
    await eventEmitter.emitPhaseCompleted('run-123', 'plan', 1000, { output: 'data' });

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('emit_event.py'),
      expect.objectContaining({
        'event-type': 'phase.completed',
        'run-id': 'run-123',
        'phase-name': 'plan',
        'duration-ms': 1000,
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should handle Python script errors gracefully', async () => {
    const errorEngine = {
      runScript: vi.fn().mockRejectedValue(new Error('Python script failed')),
    } as unknown as PythonEngine;

    const emitter = new EventEmitter(errorEngine);

    // Should not throw
    await emitter.emitRunCreated('run-123', 'baseline', {}, 'fp1');
  });

  it('should handle Python script returning success=false', async () => {
    const failEngine = {
      runScript: vi.fn().mockResolvedValue({ success: false, error: 'Validation failed' }),
    } as unknown as PythonEngine;

    const emitter = new EventEmitter(failEngine);

    // Should not throw
    await emitter.emitRunCreated('run-123', 'baseline', {}, 'fp1');
  });
});
