import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const matrixUrl = new URL('../../docs/public/compat/esbuild-js-api.md', import.meta.url);

describe('esbuild compatibility tiers', () => {
  it('reports upstream clients, the SW requirement and the remaining exact-version ceiling', async () => {
    const matrix = await readFile(matrixUrl, 'utf8');
    expect(matrix).toContain('No-COI uses the upstream 0.28.0 Node client');
    expect(matrix).toContain('an active rifty SW is required');
    expect(matrix).toContain('| No-COI upstream Node client | ⚠️ |');
    expect(matrix).toContain('| COI Sync family | ⚠️ |');
    expect(matrix).not.toContain('No-COI D4 gap:');
  });
});
