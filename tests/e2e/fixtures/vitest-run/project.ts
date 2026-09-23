export const vitestProject = {
  'package.json': JSON.stringify({
    name: 'vitest-demo',
    version: '1.0.0',
    type: 'module',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '4.1.11' },
    overrides: { vite: '8.0.16' },
  }),
  'vitest.config.ts':
    "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });",
  'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b;',
  'src/sum.test.ts':
    "import { expect, test } from 'vitest'; import { sum } from './sum'; test('adds numbers', () => expect(sum(1, 2)).toBe(3)); test('reveals a failing expectation', () => expect(sum(1, 2)).toBe(4));",
  'excluded.test.ts': `throw new Error('CONFIG_INCLUDE_WAS_IGNORED');`,
} as const;
