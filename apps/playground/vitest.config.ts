import { defineConfig } from 'vitest/config';

/**
 * Local vitest config for the playground app. The workspace runner in
 * `vitest.workspace.ts` only picks up `packages/*` and `tests/*`; the
 * playground keeps its own config so its tests stay scoped to the app
 * (and pick up the Solid JSX runtime via the same `@rifty/playground`
 * tsconfig). Run with `pnpm --filter @rifty/playground test:run`.
 */
export default defineConfig({
  test: {
    name: 'playground',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
