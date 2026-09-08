import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const integrationRoot = dirname(fileURLToPath(import.meta.url));
const consumerRoot = resolve(integrationRoot, 'fixtures/workbench-vite-consumer');

describe('packed consumer uses copyable runtime assets', () => {
  it('compiles no Worker/SW entries and ships no builtin alias or QuickJS wrapper', () => {
    const main = readFileSync(resolve(consumerRoot, 'src/main.ts'), 'utf8');
    expect(main).not.toMatch(/\?worker&url/);
    expect(existsSync(resolve(consumerRoot, 'host-builtins.ts'))).toBe(false);
    expect(existsSync(resolve(consumerRoot, 'src/kernel-worker-entry.ts'))).toBe(false);
  });
});
