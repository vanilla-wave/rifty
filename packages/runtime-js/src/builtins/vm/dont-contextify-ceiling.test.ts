/**
 * Rifty ceiling contract, not Node parity: Node's `DONT_CONTEXTIFY` returns
 * the global object of a fresh, non-contextified V8 context; rifty's engines
 * contextify a given object only (ADR-0142, ADR-0464), so every entry that would build
 * such a context throws `NotImplementedError('vm.createContext.DONT_CONTEXTIFY')`
 * — jsdom 30 under vitest `environment: 'jsdom'` (epic
 * `jsdom-environment-in-browser`). `vm.constants` itself is parity
 * (`tools/node-parity-runner/cases/vm/constants.case.ts`).
 */
import { describe, expect, it } from 'vitest';
import vm from './index.ts';

function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectCeiling(call: () => unknown): void {
  const error = thrownBy(call);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: 'NotImplementedError',
    feature: 'vm.createContext.DONT_CONTEXTIFY',
  });
  expect((error as Error).message).toMatch(/^Not implemented: vm\.createContext\.DONT_CONTEXTIFY/u);
}

describe('vm.constants.DONT_CONTEXTIFY is a named ceiling', () => {
  const { DONT_CONTEXTIFY } = vm.constants;

  it('createContext(DONT_CONTEXTIFY) throws, with or without valid options', () => {
    expectCeiling(() => vm.createContext(DONT_CONTEXTIFY));
    expectCeiling(() => vm.createContext(DONT_CONTEXTIFY, { name: 'jsdom' }));
  });

  it('runInNewContext and Script.runInNewContext with DONT_CONTEXTIFY throw the same ceiling', () => {
    expectCeiling(() => vm.runInNewContext('1 + 1', DONT_CONTEXTIFY));
    expectCeiling(() => new vm.Script('1 + 1').runInNewContext(DONT_CONTEXTIFY));
  });

  it('a symbol that is not DONT_CONTEXTIFY is not the ceiling', () => {
    const error = thrownBy(() => vm.createContext(Symbol('vm_context_no_contextify')));
    expect(error).not.toMatchObject({ name: 'NotImplementedError' });
  });
});
