import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const integrationRoot = dirname(fileURLToPath(import.meta.url));
const consumerMain = resolve(integrationRoot, 'fixtures/workbench-vite-consumer/src/main.ts');
const packedRunner = resolve(integrationRoot, 'workbench-packed-consumer.mjs');

describe('packed host scenario composition (I7 + I1 residual)', () => {
  it('produces from the installed workbench tarball and boots the composed host', () => {
    const main = readFileSync(consumerMain, 'utf8');
    const runner = readFileSync(packedRunner, 'utf8');
    expect(runner).toMatch(/produceDepSnapshot/);
    expect(runner).toMatch(/@riftydev\/workbench\/dep-snapshot/);
    expect(main).toMatch(/produceDepSnapshot|snapshotId|dep-snapshot/);
    expect(main).not.toMatch(/registryUrl/);
    expect(main).toMatch(/scope:\s*['"]\/sandbox\//);
    expect(main).toMatch(/previewPrefix:\s*['"]\/sandbox\/preview['"]/);
    expect(main).toMatch(/namespace:/);
    expect(main).toMatch(/ownerStartupTimeoutMs/);
    expect(main).toMatch(/projectFileTimeoutMs/);
    expect(main).toMatch(/sessionToolsTimeoutMs/);
  });
});
