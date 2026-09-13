import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyViteRootUrlPatch,
  viteRootUrlPatchPolicy,
} from './runtime/vite-cli-install-policy.ts';

const source = execFileSync(
  'tar',
  [
    '-xOzf',
    fileURLToPath(
      new URL(
        '../../../tests/integration/fixtures/registry/rollup-companions/packages/vite-7.3.6.tgz',
        import.meta.url,
      ),
    ),
    'package/dist/node/chunks/config.js',
  ],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

/** Execute the real upstream normalization function; these cases take no filesystem branch. */
function normalizeId(source: string, root: string, id: string): string {
  const extract = (name: string) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Upstream ${name} missing`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const normalize = new Function(`
    const VALID_ID_PREFIX = '/@id/';
    const NULL_BYTE_PLACEHOLDER = '__x00__';
    ${extract('withTrailingSlash')}
    ${extract('wrapId')}
    ${extract('normalizeResolvedIdToUrl')}
    return normalizeResolvedIdToUrl;
  `)() as (
    environment: { config: { root: string } },
    url: string,
    resolved: { id: string },
  ) => string;
  return normalize({ config: { root } }, id, { id });
}

describe('upstream Vite module URLs at filesystem root', () => {
  it('reproduces the split Refresh identity in original Vite and restores ordinary-root semantics', () => {
    expect(normalizeId(source, '/', '/@react-refresh')).toBe('/@id//@react-refresh');
    expect(normalizeId(source, '/app', '/@react-refresh')).toBe('/@react-refresh');
    const fixed = applyViteRootUrlPatch(source);
    for (const relative of ['/src/components/FilterBar.tsx', '/node_modules/.vite/deps/react.js']) {
      expect(normalizeId(fixed, '/', relative)).toBe(
        normalizeId(source, '/app', `/app${relative}`),
      );
    }
    expect(normalizeId(fixed, '/', '/@react-refresh')).toBe('/@react-refresh');
    expect(normalizeId(fixed, '/app', '/@react-refresh')).toBe('/@react-refresh');
    expect(applyViteRootUrlPatch(fixed)).toBe(fixed);
  });

  it('rejects missing, duplicate and mixed original/prepared anchors', () => {
    const { needle, replacement } = viteRootUrlPatchPolicy;
    for (const invalid of [
      source.replace(needle, 'changedUpstream()'),
      source + needle,
      source + replacement,
    ])
      expect(() => applyViteRootUrlPatch(invalid)).toThrow(
        /expected exactly one resolved-id root slice/,
      );
  });
});
