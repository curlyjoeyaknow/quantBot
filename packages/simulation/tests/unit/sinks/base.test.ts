import { describe, it, expect } from 'vitest';
import type { ResultSink, BaseSinkOptions } from '../../../src/sinks/base';

// Test that base types are properly defined
describe('Sink Base Types', () => {
  it('should have ResultSink interface', () => {
    // Type check - if this compiles, the interface is correct
    const sink: ResultSink = {
      name: 'test',
      handle: async () => {},
    };
    expect(sink.name).toBe('test');
  });

  it('should have BaseSinkOptions interface', () => {
    const options: BaseSinkOptions = {
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    };
    expect(options.logger).toBeDefined();
  });
});
