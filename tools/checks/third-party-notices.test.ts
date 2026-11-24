import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import {
  THRESHOLD,
  WINDOWS,
  discoverSources,
  evaluateTarball,
  fingerprint,
  normalize,
  share,
} from './third-party-notices.mjs';

const UNDICI = 'packages/runtime-js/src/builtins/fetch/generated';

/** Re-bundle as tsup does (esbuild, ESM, unminified, legal comments kept). */
async function bundle(entry: string, externalRe?: RegExp) {
  const r = await build({
    plugins: externalRe
      ? [
          {
            name: 'ext',
            setup: (b) =>
              b.onResolve({ filter: externalRe }, (a) => ({ path: a.path, external: true })),
          },
        ]
      : [],
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

const undici = () => discoverSources(process.cwd(), [UNDICI.replace(/\/generated$/u, '')]);

describe('fingerprint on real bundles (threshold/window measurement)', () => {
  it('a re-bundled artifact keeps well above THRESHOLD; first-party code around it stays near 0', async () => {
    const { sources } = undici();
    const [artifact] = sources[0].artifacts;
    const bundled = normalize(await bundle(`${UNDICI}/classes.js`));
    // False-positive candidate: rifty's own fetch install over the same API names.
    const ownCode = normalize(
      await bundle(
        'packages/runtime-js/src/builtins/fetch/install.ts',
        /\/generated\/|^@riftydev\//,
      ),
    );
    const hit = share(artifact.windows, bundled);
    const noise = share(artifact.windows, ownCode);
    expect(hit).toBeGreaterThan(THRESHOLD + 0.15);
    expect(noise).toBeLessThan(3 / WINDOWS);
    expect(
      evaluateTarball(sources, {
        pkg: 'p',
        files: [{ path: 'dist/own.js', text: ownCode }],
      }),
    ).toEqual({ hits: [], violations: [] });
  });

  it('the generated undici artifact reaches its bundle with undici.LICENSE', async () => {
    const { sources } = undici();
    const text = await bundle(`${UNDICI}/classes.js`);
    expect(
      evaluateTarball(sources, { pkg: 'p', files: [{ path: 'dist/x.js', text }] }).violations,
    ).toEqual([]);
  });
});

describe('mutants', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const code = () => readFileSync(`${UNDICI}/classes.js`, 'utf8');
  const license = 'Copyright (c) Upstream Authors\n\nPermission is hereby granted …\n';

  function pkg(withLicense: boolean) {
    root = mkdtempSync(join(tmpdir(), 'tpn-'));
    const dir = join(root, 'pkg/src/feature/generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'upstream.js'), code());
    if (withLicense) writeFileSync(join(dir, 'upstream.LICENSE'), license);
    return discoverSources(root, ['pkg']);
  }

  it('notice removed from the packed file → red; in the file or a tarball LICENSE → green', () => {
    const { sources, violations } = pkg(true);
    expect(violations).toEqual([]);
    const withNotice = `/*! ${license} */\n${code()}`;
    expect(
      evaluateTarball(sources, { pkg: 'p', files: [{ path: 'dist/a.js', text: withNotice }] })
        .violations,
    ).toEqual([]);
    expect(
      evaluateTarball(sources, {
        pkg: 'p',
        files: [
          { path: 'dist/a.js', text: code() },
          { path: 'THIRD_PARTY_NOTICES.md', text: license },
        ],
      }).violations,
    ).toEqual([]);
    const stripped = evaluateTarball(sources, {
      pkg: 'p',
      files: [{ path: 'dist/a.js', text: code() }],
    });
    expect(stripped.violations).toEqual([
      expect.stringContaining('dist/a.js: contains pkg/src/feature/generated/upstream.js'),
    ]);
  });

  it('new generated source without <origin>.LICENSE → red', () => {
    expect(pkg(false).violations).toEqual([
      'pkg/src/feature/generated/upstream.js: generated/vendored file without an <origin>.LICENSE in its dir and not on FIRST_PARTY',
    ]);
  });

  it('upstream file added next to a FIRST_PARTY file → red; the listed file alone → green', () => {
    expect(discoverSources(process.cwd(), ['packages/runtime-js/src/internal']).violations).toEqual(
      [],
    );
    root = mkdtempSync(join(tmpdir(), 'tpn-'));
    const dir = join(root, 'packages/runtime-js/src/internal/generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proxy-identity.js'), 'export default "";');
    writeFileSync(join(dir, 'upstream.js'), code());
    expect(discoverSources(root, ['packages/runtime-js/src/internal']).violations).toEqual([
      expect.stringContaining('internal/generated/upstream.js: generated/vendored file without'),
    ]);
  });

  it('JSON-embedded copy (vendored .d.ts bundle) is matched through escapes', () => {
    const { sources } = pkg(true);
    const text = JSON.stringify({ 'lib.d.ts': code() });
    expect(
      evaluateTarball(sources, { pkg: 'p', files: [{ path: 'vendor/x.json', text }] }).hits,
    ).toHaveLength(1);
  });

  it('an artifact too small to fingerprint is loud, not skipped', () => {
    expect(fingerprint('x'.repeat(100))).toEqual([]);
    root = mkdtempSync(join(tmpdir(), 'tpn-'));
    const dir = join(root, 'pkg/generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.js'), 'export default 1;');
    writeFileSync(join(dir, 'a.LICENSE'), license);
    expect(discoverSources(root, ['pkg']).violations).toEqual([
      'pkg/generated/a.js: too small to fingerprint',
      'pkg/generated: carries a license but no artifact',
    ]);
  });
});
