import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('owns early required-tarball failures while descendant metadata is pending', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./_test-fixtures/deferred-acquisition-probe.ts', import.meta.url)),
    ],
    { timeout: 30_000 },
  );
  expect(JSON.parse(stdout)).toEqual(
    [false, true].map((hook) => ({
      hook,
      unhandled: 0,
      sameFailure: true,
      lockPublished: false,
      failedPackageReported: false,
    })),
  );
}, 35_000);
