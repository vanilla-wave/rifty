import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { honestShadowSubstitutionGaps } from '../compat-matrix-generator/honest-shadow-substitution-inventory.mjs';

const repoRoot = new URL('../../', import.meta.url);
const compatRoot = new URL('../../docs/public/compat/', import.meta.url);

describe('honest shadow-substitution compatibility inventory', () => {
  it('publishes every version, protocol, adapter, and owner ceiling as compat ❌', async () => {
    const markdown = await readFile(
      new URL('honest-shadow-substitutions.md', compatRoot),
      'utf8',
    ).catch(() => '');

    for (const entry of honestShadowSubstitutionGaps) {
      expect(markdown, entry.gap).toContain(`\`${entry.gap}\``);
    }
    expect(markdown.match(/\| [^\n]+ \| ❌ \|/gu)).toHaveLength(
      honestShadowSubstitutionGaps.length,
    );
  });

  it('keeps every inventoried owner and sibling adapter tied to its loud source site', async () => {
    for (const entry of honestShadowSubstitutionGaps) {
      for (const site of entry.sites) {
        const source = await readFile(new URL(site.source, repoRoot), 'utf8');
        expect(source, `${entry.gap}: ${site.source}`).toContain(site.needle);
      }
    }
  });
});
