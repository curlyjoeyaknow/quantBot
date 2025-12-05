// Test setup file
import { config } from 'dotenv';
import { vi, afterAll, afterEach, beforeAll } from 'vitest';

// Load test environment variables
config({ path: '.env.test' });

// Mock fs.createWriteStream globally for winston-daily-rotate-file
vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      pipe: vi.fn(),
    })),
  };
});

// Mock winston-daily-rotate-file to prevent file system issues in tests
vi.mock('winston-daily-rotate-file', () => {
  const MockTransport = vi.fn().mockImplementation(() => ({
    log: vi.fn(),
    query: vi.fn(),
    stream: vi.fn(),
  }));
  // For compatibility with how Winston expects transport prototypes
  Object.assign(MockTransport.prototype, {
    log: vi.fn(),
    query: vi.fn(),
    stream: vi.fn(),
  });
  return {
    __esModule: true,
    default: MockTransport,
  };
});

// Mock console methods to reduce noise in tests
// eslint-disable-next-line no-console
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Global cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
});

// Global cleanup after all tests
afterAll(() => {
  vi.restoreAllMocks();
});
