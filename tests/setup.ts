import { vi } from 'vitest';

// Provide Jest globals for legacy tests
(globalThis as any).jest = vi;

// Map doMock to vi.doMock for compatibility
(globalThis as any).jest.doMock = vi.doMock;

// Mock process.exit to prevent tests from exiting
const originalExit = process.exit;
process.exit = vi.fn() as typeof process.exit;
