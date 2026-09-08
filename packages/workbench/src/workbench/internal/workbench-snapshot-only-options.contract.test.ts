import { describe, expect, it } from 'vitest';
import { inspectPageToWorkbenchOwnerMessage } from '../owner-protocol.ts';
import { validateUrlContext, validateWorkbenchOptions } from './workbench-options.ts';

const context = validateUrlContext({
  apiBaseUrl: 'https://host.test/',
  clientUrl: 'https://host.test/app/',
});

function options(packageAcquisition: unknown) {
  return {
    deployment: {
      workers: { owner: '/owner.js', kernel: '/kernel.js', node: '/node.js', devServer: '/dev.js' },
      serviceWorker: { url: '/sw.js', scope: '/' },
      wasm: { sqlite: '/sqlite.wasm' },
    },
    packageAcquisition,
    storage: { persistence: 'ephemeral' },
  };
}

function boot(packageAcquisition: unknown) {
  return {
    type: 'workbench:initialize',
    config: {
      deployment: {
        workers: {
          kernel: 'https://host.test/kernel.js',
          node: 'https://host.test/node.js',
          devServer: 'https://host.test/dev.js',
        },
        wasm: { sqlite: 'https://host.test/sqlite.wasm' },
        previewProbeTimeoutMs: 1000,
      },
      packageAcquisition,
      storage: { persistence: 'ephemeral' },
    },
  };
}

describe('I3 acquisition policy is a closed public and owner union', () => {
  it.each([
    [{ mode: 'snapshot-only' }, { mode: 'snapshot-only' }],
    [
      { registryUrl: '/registry' },
      { mode: 'registry', registryUrl: 'https://host.test/registry/' },
    ],
    [
      { mode: 'registry', registryUrl: '/registry' },
      { mode: 'registry', registryUrl: 'https://host.test/registry/' },
    ],
    [
      {
        registryUrl: '/registry',
        eddy: { resolverUrl: '/eddy', presetPins: { starter: 'locked-closure' } },
      },
      {
        mode: 'registry',
        registryUrl: 'https://host.test/registry/',
        eddy: {
          resolverUrl: 'https://host.test/eddy/',
          bundleBaseUrl: 'https://host.test/eddy/',
          presetPins: { starter: 'locked-closure' },
        },
      },
    ],
  ])('owns %j and carries it unchanged across the owner wire', (input, expected) => {
    const validated = validateWorkbenchOptions(options(input), context);
    expect(validated.owner.packageAcquisition).toEqual(expected);
    expect(Object.isFrozen(validated.owner.packageAcquisition)).toBe(true);
    const frame = inspectPageToWorkbenchOwnerMessage(
      structuredClone(boot(validated.owner.packageAcquisition)),
    );
    expect(frame.type).toBe('workbench:initialize');
    if (frame.type !== 'workbench:initialize') throw new Error('initialize frame required');
    expect(frame.config.packageAcquisition).toEqual(expected);
    expect(Object.isFrozen(frame.config.packageAcquisition)).toBe(true);
  });

  it('owner independently accepts the URL-free branch', () => {
    const frame = inspectPageToWorkbenchOwnerMessage(boot({ mode: 'snapshot-only' }));
    expect(frame.type).toBe('workbench:initialize');
    if (frame.type !== 'workbench:initialize') throw new Error('initialize frame required');
    expect(frame.config.packageAcquisition).toEqual({ mode: 'snapshot-only' });
  });

  it.each([
    { mode: 'snapshot-only', registryUrl: 'https://registry.test/' },
    { mode: 'snapshot-only', eddy: { resolverUrl: 'https://eddy.test/' } },
    { mode: 'snapshot-only', registryUrl: undefined },
    { mode: 'snapshot-only', eddy: undefined },
    { mode: 'snapshot-only', snapshotUrl: '/old.json' },
    { mode: 'snapshot-only', extra: true },
    { mode: 'unknown', registryUrl: 'https://registry.test/' },
    { mode: 'registry' },
    { registryUrl: 'https://registry.test/', extra: true },
    {},
  ])('rejects contradictory or unknown public and owner data %j', (input) => {
    expect.soft(() => validateWorkbenchOptions(options(input), context)).toThrow(TypeError);
    expect.soft(() => inspectPageToWorkbenchOwnerMessage(boot(input))).toThrow(TypeError);
  });

  it.each(['mode', 'registryUrl', 'eddy'] as const)(
    'rejects public %s accessor before executing it',
    (field) => {
      let calls = 0;
      const input = Object.defineProperty(
        { mode: 'registry', registryUrl: 'https://registry.test/' },
        field,
        {
          enumerable: true,
          get() {
            calls++;
            return field === 'mode'
              ? 'registry'
              : field === 'registryUrl'
                ? 'https://registry.test/'
                : undefined;
          },
        },
      );
      expect.soft(() => validateWorkbenchOptions(options(input), context)).toThrow(TypeError);
      expect.soft(calls).toBe(0);
    },
  );

  it('rejects inherited acquisition data before selecting a branch', () => {
    const input = Object.create({ mode: 'registry', registryUrl: 'https://registry.test/' });
    expect(() => validateWorkbenchOptions(options(input), context)).toThrow(TypeError);
  });
});
