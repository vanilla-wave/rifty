import { configDefaults, defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/playground/vitest.config.ts',
  'apps/landing/vitest.config.ts',
  {
    test: {
      name: 'unit',
      include: [
        'packages/*/src/**/*.test.ts',
        'packages/*/tests/**/*.test.ts',
        'services/*/src/**/*.test.ts',
        'services/*/tests/**/*.test.ts',
        'tools/*/src/**/*.test.ts',
        'tools/checks/**/*.test.ts',
      ],
      exclude: [...configDefaults.exclude, 'packages/isolate-host/**', 'packages/isolate-guest/**'],
      environment: 'node',
    },
  },
  {
    // ADR-0557: real child processes + isolated-vm over the built packages.
    test: {
      name: 'isolate-host',
      include: [
        'packages/isolate-host/tests/**/*.test.ts',
        'packages/isolate-guest/tests/**/*.test.ts',
      ],
      globalSetup: ['packages/isolate-host/tests/global-setup.ts'],
      environment: 'node',
      testTimeout: 60_000,
    },
  },
  {
    test: {
      name: 'conformance',
      include: ['tests/conformance/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'parity',
      include: ['tools/node-parity-runner/cases/**/*.test.ts'],
      environment: 'node',
    },
  },
]);
