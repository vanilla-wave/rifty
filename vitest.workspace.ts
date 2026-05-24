import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: [
        'packages/*/src/**/*.test.ts',
        'packages/*/tests/**/*.test.ts',
        'tools/*/src/**/*.test.ts',
      ],
      environment: 'node',
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
