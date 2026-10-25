/**
 * Rifty ceiling contract, not Node parity: `http.Agent` manages a socket pool
 * the browser runtime does not have, so constructing one — directly or via a
 * subclass (playwright-core `utilsBundle.js`, vitest browser mode) — throws
 * `NotImplementedError('node:http.Agent')`, as `https.Agent` does (ADR-0181
 * D3). Shape is parity (`tools/node-parity-runner/cases/http/agent-shape.case.ts`).
 */
import { describe, expect, it } from 'vitest';
import { createNetBuiltinOverrides } from '../register-builtins.ts';
import http from './index.ts';

type AgentClass = new (options?: Record<string, unknown>) => object;

function agentOf(module: unknown): AgentClass {
  const value = (module as Record<string, unknown>).Agent;
  if (typeof value !== 'function') throw new TypeError(`http.Agent is ${typeof value}`);
  return value as AgentClass;
}

function expectCeiling(construct: () => unknown): void {
  let caught: unknown;
  try {
    construct();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ name: 'NotImplementedError', feature: 'node:http.Agent' });
  expect((caught as Error).message).toMatch(/^Not implemented: node:http\.Agent/u);
}

describe('node:http.Agent is a named ceiling', () => {
  it('new http.Agent() and new http.Agent({ keepAlive: true }) throw', () => {
    const Agent = agentOf(http);
    expectCeiling(() => new Agent());
    expectCeiling(() => new Agent({ keepAlive: true }));
  });

  it('a subclass constructs into the same ceiling', () => {
    class Pooled extends agentOf(http) {}
    expectCeiling(() => new Pooled({ keepAlive: true }));
  });

  it('the loader-local node:http carries the same Agent', () => {
    const local = createNetBuiltinOverrides(Symbol('loader')).get('node:http');
    expect(agentOf(local)).toBe(agentOf(http));
  });
});
