import { describe, expect, it } from 'vitest';
import { playgroundRuntimeDecision } from './playground-runtime-decision.ts';

describe('Playground concrete runtime decision', () => {
  it('carries the Vite owner port and keeps finite Node kinds port-free', () => {
    expect(playgroundRuntimeDecision({ kind: 'vite', port: 5174 })).toEqual({
      kind: 'vite',
      port: 5174,
    });
    expect(playgroundRuntimeDecision({ kind: 'node-server' })).toEqual({
      kind: 'node-server',
    });
    expect(playgroundRuntimeDecision({ kind: 'node-cli' })).toEqual({ kind: 'node-cli' });
  });

  it('rejects a Vite definition without its concrete owner port', () => {
    expect(() => playgroundRuntimeDecision({ kind: 'vite' })).toThrow(/missing its owner port/);
  });
});
