import { afterEach, describe, expect, it } from 'vitest';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess, installProcessGlobals } from './process.ts';

type GlobalWithNodeAlias = typeof globalThis & { global?: typeof globalThis };

const originalGlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'global');
const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
const originalActiveProcess = readActiveNodeProcessBootstrap();

afterEach(() => {
  setActiveNodeProcessBootstrap(
    originalActiveProcess?.process ?? null,
    originalActiveProcess?.federated ?? false,
  );
  if (originalProcessDescriptor) {
    Object.defineProperty(globalThis, 'process', originalProcessDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'process');
  }
  if (originalGlobalDescriptor) {
    Object.defineProperty(globalThis, 'global', originalGlobalDescriptor);
  } else {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');
  }
});

describe('installProcessGlobals', () => {
  it('installs the Node global alias for browser worker realms', () => {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');

    installProcessGlobals();

    expect((globalThis as GlobalWithNodeAlias).global).toBe(globalThis);
  });

  it('installs global with Node’s descriptor (enumerable own data property, not a hidden alias)', () => {
    const savedProcess = (globalThis as { process?: unknown }).process;
    // installProcessGlobals short-circuits when process is already a NodeProcess
    // (test 1 installed it); reset so the global-alias install actually runs.
    (globalThis as { process?: unknown }).process = undefined;
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');
    try {
      installProcessGlobals();

      // Node: `Object.getOwnPropertyDescriptor(globalThis,'global')` is
      // {writable:true, enumerable:true, configurable:true} and shows up in
      // Object.keys(globalThis). A non-enumerable alias would diverge.
      expect(Object.getOwnPropertyDescriptor(globalThis, 'global')).toMatchObject({
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(Object.keys(globalThis)).toContain('global');
    } finally {
      (globalThis as { process?: unknown }).process = savedProcess;
    }
  });

  it('does not downgrade or replace an existing trusted bootstrap binding', () => {
    const trusted = new NodeProcess();
    const guestReplacement = Object.create(trusted) as NodeProcess;
    setActiveNodeProcessBootstrap(trusted, true);
    Object.defineProperty(globalThis, 'process', {
      value: guestReplacement,
      writable: true,
      configurable: true,
    });

    installProcessGlobals();

    expect(readActiveNodeProcessBootstrap()).toEqual({
      process: trusted,
      identity: null,
      federated: true,
    });
  });
});
