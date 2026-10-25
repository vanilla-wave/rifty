import { describe, expect, it } from 'vitest';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';
import { inspectPageToWorkbenchOwnerMessage } from './owner-protocol.ts';

const MAX = 2_147_483_647;
const context = validateUrlContext({
  apiBaseUrl: 'https://host.test/',
  clientUrl: 'https://host.test/',
});
const workers = {
  owner: '/owner.js',
  kernel: '/kernel.js',
  node: '/node.js',
  devServer: '/dev.js',
};
function normalized(values: Record<string, number>) {
  return validateWorkbenchOptions(
    {
      deployment: {
        workers,
        wasm: { sqlite: '/sql.wasm' },
        serviceWorker: { url: '/sw.js', scope: '/' },
        ...values,
      },
      storage: { persistence: 'required' },
      packageAcquisition: { mode: 'snapshot-only' },
    },
    context,
  ).owner.deployment as unknown as Record<string, unknown>;
}
function wire(values: Record<string, unknown>) {
  const { owner: _, ...guestWorkers } = workers;
  const result = inspectPageToWorkbenchOwnerMessage({
    type: 'workbench:initialize',
    config: {
      deployment: {
        workers: guestWorkers,
        wasm: { sqlite: '/sql.wasm' },
        previewProbeTimeoutMs: 3000,
        ...values,
      },
      storage: { persistence: 'required' },
      packageAcquisition: { mode: 'snapshot-only' },
    },
  });
  if (result.type !== 'workbench:initialize') throw new Error('Expected real boot decoder');
  return result.config.deployment as unknown as Record<string, unknown>;
}

describe('I7 shared native report budget uses captured explicit configuration', () => {
  it.each([
    'ownerStartupTimeoutMs',
    'projectFileCommitTimeoutMs',
    'playgroundRequestTimeoutMs',
    'ownerOperationSilenceTimeoutMs',
  ])('%s alone governs shared report without inventing sibling defaults', (field) => {
    expect(normalized({ [field]: 10.1 }).ioReportTimeoutMs).toBe(11);
    expect(normalized({ [field]: 90000 }).ioReportTimeoutMs).toBe(90000);
  });
  it('takes the maximum after upward normalization and excludes P', () => {
    for (const previewProbeTimeoutMs of [1, MAX]) {
      expect(
        normalized({
          ownerStartupTimeoutMs: 10.1,
          projectFileCommitTimeoutMs: 20.2,
          playgroundRequestTimeoutMs: 30.3,
          ownerOperationSilenceTimeoutMs: 40.4,
          previewProbeTimeoutMs,
        }).ioReportTimeoutMs,
      ).toBe(41);
    }
  });
  it('all omitted and P-only keep existing instance report default', () => {
    expect(Object.hasOwn(normalized({}), 'ioReportTimeoutMs')).toBe(false);
    expect(Object.hasOwn(normalized({ previewProbeTimeoutMs: MAX }), 'ioReportTimeoutMs')).toBe(
      false,
    );
  });
});

describe('I7 existing boot decoder owns captured native timer values', () => {
  it.each(['ownerStartupTimeoutMs', 'ioReportTimeoutMs', 'previewProbeTimeoutMs'])(
    '%s admits only normalized integer native delays and freezes them',
    (field) => {
      for (const value of [1, 90000, MAX]) {
        const result = wire({ [field]: value });
        expect(result[field]).toBe(value);
        expect(Object.isFrozen(result)).toBe(true);
      }
      for (const value of [
        undefined,
        null,
        '90000',
        0,
        -1,
        1.1,
        Number.MIN_VALUE,
        MAX + 0.25,
        MAX + 1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        expect(() => wire({ [field]: value })).toThrow(TypeError);
      }
    },
  );
  it('omission preserves baseline boot shape', () => {
    const result = wire({});
    expect(Object.hasOwn(result, 'ownerStartupTimeoutMs')).toBe(false);
    expect(Object.hasOwn(result, 'ioReportTimeoutMs')).toBe(false);
    expect(result.previewProbeTimeoutMs).toBe(3000);
  });
});
