import { afterEach, expect, it, vi } from 'vitest';
import { createSandbox } from './index.ts';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { storage: { namespace: '' } },
  { storage: { namespace: '..' } },
  { storage: { namespace: 'a/b' } },
  { storage: { namespace: 'a\\b' } },
  { storage: { namespace: '\0' } },
  { storage: { namespace: 42 } },
  { storage: { persistence: 'unknown' } },
  { storage: null },
  ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, '1000'].map((startupTimeoutMs) => ({
    startupTimeoutMs,
  })),
])('invalid public boot option rejects before effects: %j', async (extra) => {
  const WorkerBoundary = vi.fn(() => {
    throw new Error('Worker effect');
  });
  vi.stubGlobal('Worker', WorkerBoundary);
  const registerSw = vi.fn(async () => {});
  const options = {
    requireCrossOriginIsolation: false as const,
    toolchain: { workerUrl: '/worker.js' },
    ...extra,
  };
  await expect(createSandbox(options, { registerSw })).rejects.toThrow(/storage|startupTimeoutMs/);
  expect(WorkerBoundary).not.toHaveBeenCalled();
  expect(registerSw).not.toHaveBeenCalled();
});
