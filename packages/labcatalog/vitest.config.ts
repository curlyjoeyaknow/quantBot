import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    server: {
      deps: {
        // Inline zod to avoid Vitest SSR module resolution issues with Zod v4
        inline: ['zod'],
      },
    },
  },
});


