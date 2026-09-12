/** I7 ingress candidate; numeric domain: independent PR316 DEC-2 decision. */
import { DEFAULT_READY_TIMEOUT_MS } from '@riftydev/service-worker';
import { describe, expect, it } from 'vitest';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';
import {
  type OpenWorkbenchDependencies,
  type WorkbenchOptions,
  createOpenWorkbench,
} from './open-workbench.ts';
import { createWorkbenchOwnerPort } from './workbench-owner-port.ts';

const MAX_DELAY = 2_147_483_647;
const fields = [
  'ownerStartupTimeoutMs',
  'projectFileCommitTimeoutMs',
  'playgroundRequestTimeoutMs',
  'ownerOperationSilenceTimeoutMs',
  'previewProbeTimeoutMs',
] as const;
type Field = (typeof fields)[number];
type Overrides = Partial<Record<Field, unknown>>;
const urlContext = {
  apiBaseUrl: 'https://host.test/app/',
  clientUrl: 'https://host.test/app/index.html',
};
const context = validateUrlContext(urlContext);
function options(overrides: Overrides = {}) {
  return {
    deployment: {
      workers: {
        owner: './owner.js',
        kernel: './kernel.js',
        node: './node.js',
        devServer: './dev.js',
      },
      serviceWorker: { url: './sw.js?opaque=%20~', scope: '/app/' },
      wasm: { sqlite: './sqlite.wasm' },
      ...overrides,
    },
    storage: { persistence: 'ephemeral' as const },
    packageAcquisition: { mode: 'snapshot-only' as const },
  };
}
function normalized(overrides: Overrides = {}) {
  return validateWorkbenchOptions(options(overrides), context).owner
    .deployment as unknown as Partial<Record<Field, number>>;
}

function browserEffectsBoundary() {
  const effects: string[] = [];
  const failure = new Error('Unexpected browser effect at ingress test boundary');
  const fail = (effect: string): never => {
    effects.push(effect);
    throw failure;
  };
  const dependencies: OpenWorkbenchDependencies = {
    urlContext: () => urlContext,
    capabilities: () => {
      effects.push('capabilities');
      return { dom: true, worker: true, crossOriginIsolated: true, webLocks: true };
    },
    locks: { request: async () => fail('locks.request') },
    serviceWorker: {
      register: async () => fail('serviceWorker.register'),
      controller: null,
      addEventListener: () => fail('serviceWorker.listen'),
      removeEventListener: () => {},
    },
    owner: createWorkbenchOwnerPort({ startWorkspaceOwner: () => fail('owner.spawn') }),
    timers: { setTimeout: () => fail('timer'), clearTimeout: () => {} },
  };
  return { open: createOpenWorkbench(dependencies), effects, failure };
}

describe('I7 public deployment budget ingress', () => {
  it.each(fields)(
    '%s accepts representable values and rounds positive fractions upward',
    (field) => {
      for (const [value, expected] of [
        [Number.MIN_VALUE, 1],
        [0.1, 1],
        [1.1, 2],
        [60_000, 60_000],
        [MAX_DELAY - 0.25, MAX_DELAY],
        [MAX_DELAY, MAX_DELAY],
      ])
        expect(normalized({ [field]: value })[field]).toBe(expected);
    },
  );

  it.each(fields)(
    '%s rejects invalid values and original-value overflow with its field path',
    (field) => {
      for (const value of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_DELAY + 0.25,
        MAX_DELAY + 1,
        Number.MAX_VALUE,
        '100',
        false,
        null,
      ]) {
        const attempt = () => normalized({ [field]: value });
        expect(attempt).toThrow(TypeError);
        expect(attempt).toThrow(`deployment.${field}`);
      }
    },
  );

  it('preserves omission and the existing preview default without inventing B/F/T/S defaults', () => {
    for (const overrides of [{}, Object.fromEntries(fields.map((field) => [field, undefined]))]) {
      const result = normalized(overrides);
      for (const field of fields.filter((field) => field !== 'previewProbeTimeoutMs'))
        expect(Object.hasOwn(result, field)).toBe(false);
      expect(result.previewProbeTimeoutMs).toBe(DEFAULT_READY_TIMEOUT_MS);
    }
  });

  it('owns and freezes the normalized explicit values without mutating caller configuration', () => {
    const input = options({
      ownerStartupTimeoutMs: 10.1,
      projectFileCommitTimeoutMs: 20.2,
      playgroundRequestTimeoutMs: 30.3,
      ownerOperationSilenceTimeoutMs: 40.4,
      previewProbeTimeoutMs: 50.5,
    });
    const result = validateWorkbenchOptions(input, context);
    expect(input.deployment.ownerStartupTimeoutMs).toBe(10.1);
    input.deployment.ownerStartupTimeoutMs = 900;
    expect(result.owner.deployment).toMatchObject({
      ownerStartupTimeoutMs: 11,
      projectFileCommitTimeoutMs: 21,
      playgroundRequestTimeoutMs: 31,
      ownerOperationSilenceTimeoutMs: 41,
      previewProbeTimeoutMs: 51,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.owner)).toBe(true);
    expect(Object.isFrozen(result.owner.deployment)).toBe(true);
  });

  it('keeps public B/F/T/S values independent when P changes', () => {
    const base = {
      ownerStartupTimeoutMs: 100,
      projectFileCommitTimeoutMs: 200,
      playgroundRequestTimeoutMs: 300,
      ownerOperationSilenceTimeoutMs: 400,
    };
    for (const previewProbeTimeoutMs of [1.1, MAX_DELAY]) {
      const result = normalized({ ...base, previewProbeTimeoutMs });
      for (const field of fields.filter((field) => field !== 'previewProbeTimeoutMs'))
        expect(result[field]).toBe(base[field]);
    }
  });

  it.each(fields)(
    '%s overflow rejects through createOpenWorkbench before browser effects',
    async (field) => {
      const h = browserEffectsBoundary();
      const opening = h.open(options({ [field]: MAX_DELAY + 0.25 }) as unknown as WorkbenchOptions);
      await expect(opening).rejects.toThrow(TypeError);
      await expect(opening).rejects.toThrow(`deployment.${field}`);
      expect(h.effects).toEqual([]);
    },
  );

  it('the effect boundary is live for valid input and cannot fabricate a successful owner', async () => {
    const h = browserEffectsBoundary();
    await expect(h.open(options() as WorkbenchOptions)).rejects.toBe(h.failure);
    expect(h.effects).toEqual(['capabilities', 'locks.request']);
  });
});
