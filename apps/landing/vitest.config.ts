import { defineConfig } from 'vitest/config';

// Pure-logic unit tests for the explorer graph (BFS path routing, adjacency).
export default defineConfig({
  test: {
    name: 'landing',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
