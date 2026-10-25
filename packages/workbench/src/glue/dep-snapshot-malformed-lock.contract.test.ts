import { afterEach, expect, it, vi } from 'vitest';
import { produceDependencySnapshot } from './dep-snapshot-producer.ts';

afterEach(() => vi.unstubAllGlobals());

it('snapshot production rejects a syntactically invalid caller lock before any network or resolution', async () => {
  const network = vi.fn(async () => {
    throw new Error('unexpected snapshot network');
  });
  vi.stubGlobal('fetch', network);
  await expect(
    produceDependencySnapshot({
      templateId: 'pr323-invalid-lock',
      packageJsonText: '{"name":"snapshot","dependencies":{"ms":"2.0.0"}}',
      packageLockText: 'not JSON',
      registryUrl: 'https://registry.test',
    }),
  ).rejects.toThrow('Dependency snapshot requires an npm v3 lockfile');
  expect(network).not.toHaveBeenCalled();
});
