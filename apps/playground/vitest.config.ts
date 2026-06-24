import { fileURLToPath } from 'node:url';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

/**
 * Local vitest config for the playground app. The workspace runner in
 * `vitest.workspace.ts` only picks up `packages/*` and `tests/*`; the
 * playground keeps its own config so its tests stay scoped to the app
 * (and pick up the Solid JSX runtime via the same `@riftydev/playground`
 * tsconfig). Run with `pnpm --filter @riftydev/playground test:run`.
 */
export default defineConfig({
  plugins: [solid({ ssr: true })],
  resolve: {
    alias: {
      'monaco-editor': fileURLToPath(new URL('./src/glue/test-monaco-editor.ts', import.meta.url)),
    },
  },
  test: {
    name: 'playground',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
