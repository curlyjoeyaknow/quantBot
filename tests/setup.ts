// Test setup file
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Mock fs.createWriteStream globally for winston-daily-rotate-file
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    createWriteStream: jest.fn(() => ({
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      pipe: jest.fn(),
    })),
  };
});

// Mock winston-daily-rotate-file to prevent file system issues in tests
jest.mock('winston-daily-rotate-file', () => {
  const MockTransport = jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    query: jest.fn(),
    stream: jest.fn(),
  }));
  MockTransport.prototype = {
    log: jest.fn(),
    query: jest.fn(),
    stream: jest.fn(),
  };
  return {
    __esModule: true,
    default: MockTransport,
  };
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set test timeout
jest.setTimeout(30000); // Increased timeout for async operations

// Global cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Global cleanup after all tests
afterAll(() => {
  jest.restoreAllMocks();
});
