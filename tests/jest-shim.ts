import { vi } from 'vitest';

// Provide a Jest-compatible global for existing tests while using Vitest under the hood.
// This allows us to remove Jest from runtime dependencies without rewriting all tests at once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).jest = vi;


