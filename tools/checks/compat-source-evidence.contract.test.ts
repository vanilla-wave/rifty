import { describe, expect, it } from 'vitest';
import { validateCompatEvidenceSources } from '../compat-matrix-generator/source-evidence.mjs';

const repoRoot = new URL('../../', import.meta.url);
const compatRoot = new URL('../../docs/public/compat/', import.meta.url);

describe('public compatibility evidence paths', () => {
  it('exist for every finite Test Sources entry in every matrix', async () => {
    await expect(validateCompatEvidenceSources(compatRoot, repoRoot)).resolves.toBeGreaterThan(0);
  });
});
