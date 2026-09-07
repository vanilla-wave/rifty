import { describe, expect, it } from 'vitest';
import { planViteNodeEntryEdge } from './vite-node-entry-edge.ts';

describe('Vite node-entry concrete edge', () => {
  it.each([
    { args: ['--version'], activateRuntimeAdapters: false },
    { args: ['-h'], activateRuntimeAdapters: false },
    { args: ['build'], activateRuntimeAdapters: true },
  ] as const)(
    'recognizes $args before deciding adapter activation',
    ({ args, activateRuntimeAdapters }) => {
      const plan = planViteNodeEntryEdge({
        bin: true,
        root: '/workspace',
        args,
        entryPath: '/workspace/node_modules/.bin/vite',
      });

      expect(plan.activateRuntimeAdapters).toBe(activateRuntimeAdapters);
    },
  );

  it('leaves direct and other-bin entries consumer-neutral', () => {
    for (const input of [
      { bin: false, entryPath: '/workspace/direct.mjs' },
      { bin: true, entryPath: '/workspace/node_modules/.bin/other' },
    ] as const) {
      const plan = planViteNodeEntryEdge({
        ...input,
        root: '/workspace',
        args: [],
      });
      expect(plan.activateRuntimeAdapters).toBe(true);
    }
  });
});
