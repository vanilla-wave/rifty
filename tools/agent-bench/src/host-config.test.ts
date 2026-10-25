import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { catalogEndpoint } from '../tests/catalog-endpoint.ts';
import { loadConfig } from './config.ts';

it('uses reference limits by default and preserves explicit host toggles', async () => {
  expect((await loadConfig()).limits).toEqual({ maxToolCalls: 100, runTimeoutMs: 600000 });
  const directory = await mkdtemp(join(tmpdir(), 'rifty-host-config-'));
  try {
    const input = {
      endpoint: catalogEndpoint('http://127.0.0.1:1/v1', { textOnlyContent: true }),
      noCoiPolicies: {
        files: { readonlyPaths: ['package.json'] },
        shell: { allowedCommands: ['node'] },
      },
      limits: { maxToolCalls: 9, runTimeoutMs: 12345 },
    };
    const path = join(directory, 'config.json');
    await writeFile(path, JSON.stringify(input));
    expect(await loadConfig(path)).toMatchObject(input);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
