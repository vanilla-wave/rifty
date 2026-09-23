/**
 * User override VALUE classification against npm 11.17.0's own reading
 * (ADR-0451). Oracle: `npm-package-arg` `npa.resolve(<key>, <value>)` as
 * Arborist applies it to the overridden edge, plus real
 * `npm install --package-lock-only` outcomes, captured by
 * `docs/backlog/npm-client/reference/overrides-bare-version-spec-probe.mjs`.
 * Expected values come from that artifact; the test never restates them.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveOverride } from './overrides.ts';
import { resolveEffectivePackageRequest } from './shadow-shims.ts';

interface NpaReading {
  readonly type?: 'version' | 'range' | 'tag' | 'alias' | 'directory' | 'file';
  readonly name?: string;
  readonly subType?: string;
  readonly fetchSpec?: string;
  readonly error?: string;
}

interface ClassifyRow {
  readonly value: string;
  readonly npa: NpaReading;
}

interface InstallRow {
  readonly id: string;
  readonly manifest: Readonly<{ overrides?: Readonly<Record<string, string>> }>;
  readonly npa?: NpaReading;
  readonly exit: number;
  readonly error?: Readonly<{ code: string | null }>;
}

interface OverrideValueOracle {
  readonly node: string;
  readonly npm: string;
  readonly classify: readonly ClassifyRow[];
  readonly installs: readonly InstallRow[];
}

const oracle = JSON.parse(
  await readFile(
    new URL(
      '../../../docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as OverrideValueOracle;

function classified(select: (row: ClassifyRow) => boolean): readonly ClassifyRow[] {
  const rows = oracle.classify.filter(select);
  if (rows.length === 0) throw new Error('oracle selection is empty');
  return rows;
}

/** npm: '' and '*' keep the edge's own spec (Arborist `override-set.js`/`edge.js`). */
const isNoOp = (value: string) => value === '' || value === '*';

describe('user override value — npm 11.17.0 reading (ADR-0451)', () => {
  it('oracle identity', () => {
    expect([oracle.node, oracle.npm]).toEqual(['v24.16.0', '11.17.0']);
  });

  it.each(
    classified(
      ({ value, npa }) => (npa.type === 'version' || npa.type === 'range') && !isNoOp(value),
    ),
  )('bare $value resolves the OVERRIDDEN package at that spec → I1, ADR-0451', ({ value, npa }) => {
    expect(resolveOverride('vite', undefined, { vite: value })).toEqual({
      name: npa.name,
      range: npa.fetchSpec,
      source: 'user',
    });
  });

  it.each(classified(({ npa }) => npa.type === 'tag' && npa.fetchSpec === 'latest'))(
    'the dist-tag $value resolves the overridden package unconstrained → ADR-0451',
    ({ value, npa }) => {
      expect(resolveOverride('vite', undefined, { vite: value })).toEqual({
        name: npa.name,
        range: npa.fetchSpec,
        source: 'user',
      });
    },
  );

  it.each(classified(({ value, npa }) => npa.type === 'range' && value === '*'))(
    "'$value' keeps the edge spec: no user override → ADR-0451",
    ({ value }) => {
      expect(resolveEffectivePackageRequest('vite', '^8.0.0', undefined, { vite: value })).toEqual({
        override: null,
        effectiveName: 'vite',
        effectiveRange: '^8.0.0',
      });
    },
  );

  it.each(classified(({ npa }) => npa.type === 'range' && npa.fetchSpec === '^8.0.0'))(
    'a parent-scoped key reads bare $value against the CHILD package → ADR-0451',
    ({ value, npa }) => {
      expect(resolveOverride('vite', 'vitest', { 'vitest>vite': value })).toEqual({
        name: 'vite',
        range: npa.fetchSpec,
        source: 'user',
      });
    },
  );

  // Name only for range-less aliases: rifty keeps the edge range where npm
  // reads '*' — pre-existing, recorded in ADR-0451 §Divergences.
  it.each(classified(({ npa }) => npa.type === 'alias'))(
    '`npm:` is read first: $value targets a package NAME → ADR-0451',
    ({ value, npa }) => {
      const target = resolveOverride('vite', undefined, { vite: value });
      expect(target?.name).toBe(npa.name);
      expect(target?.source).toBe('user');
      if (npa.fetchSpec !== '*') expect(target?.range).toBe(npa.fetchSpec);
    },
  );

  it('the rifty `name@range` spelling keeps working (npm: EINVALIDTAGNAME) → I1', () => {
    const [row] = classified(({ value }) => value === 'vite@8.0.16');
    expect(row?.npa).toEqual({ error: 'EINVALIDTAGNAME' });
    expect(resolveOverride('vite', undefined, { vite: 'vite@8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  // npm reads these words as dist-tags of the key and finds none (ETARGET), so
  // rifty's replacement-name reading is an extension, never a misread.
  it.each(
    oracle.installs.filter((row) => row.npa?.type === 'tag' && row.error?.code === 'ETARGET'),
  )('a word npm cannot resolve ($id) keeps the rifty replacement name → ADR-0451', (row) => {
    const [key, value] = Object.entries(row.manifest.overrides ?? {})[0] ?? [];
    if (key === undefined || value === undefined) throw new Error(`${row.id}: no override`);
    expect(resolveOverride(key, undefined, { [key]: value })).toEqual({
      name: value,
      range: null,
      source: 'user',
    });
  });

  it('baked substitutions keep the rifty name grammar → I1', () => {
    expect(resolveOverride('bcrypt', undefined, {})).toEqual({
      name: 'bcryptjs',
      range: null,
      source: 'baked',
    });
  });
});
