import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LINK,
  NOTICES,
  bundleInputs,
  collect,
  publishableDirs,
  render,
  shippedUnshipped,
  unusedRecords,
  validateManifest,
} from '../publishing/third-party-notices.mjs';
import { checkPackage } from './third-party-notices.mjs';

let root: string;
const put = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const npmPkg = (name: string, version: string, license?: string) => {
  put(`node_modules/${name}/package.json`, JSON.stringify({ name, version, license: 'MIT' }));
  put(`node_modules/${name}/index.js`, 'module.exports = 1;');
  if (license) put(`node_modules/${name}/LICENSE`, license);
};
const manifest = {
  generated: {
    'pkg/src/generated': {
      files: ['up.js'],
      package: 'upstream',
      version: '1.0.0',
      resolveFrom: '.',
    },
  },
  firstParty: ['pkg/src/own/generated/ids.json'],
  npm: { 'bare@2.0.0': { licenseFiles: ['licenses/bare.LICENSE'] } },
};

/** A built package: dist/a.js bundles dep + the generated upstream file; dist/b.js is rifty's own. */
function built(inputs: Record<string, string[]>, files: Record<string, string>) {
  return (extra: Partial<Parameters<typeof checkPackage>[0]> = {}) =>
    checkPackage({
      root,
      dir: 'pkg',
      name: '@riftydev/pkg',
      packed: Object.keys(files),
      read: (p: string) => files[p],
      inputs,
      manifest,
      ...extra,
    });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tpn-'));
  npmPkg('dep', '3.1.0', 'MIT © Dep Authors');
  npmPkg('upstream', '1.0.0', 'MIT © Upstream Authors');
  npmPkg('bare', '2.0.0');
  put('licenses/bare.LICENSE', 'MIT © Bare Author (from its README)');
  put('pkg/src/generated/up.js', 'export default 1;');
  for (const f of ['pkg/src/a.ts', 'pkg/src/b.ts', 'pkg/src/own/generated/ids.json']) put(f, 'x');
  put('pkg/tsup.config.ts', 'export default { dts: true };');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const inputs = {
  'dist/a.js': ['node_modules/dep/index.js', 'pkg/src/generated/up.js', 'pkg/src/a.ts'],
  'dist/b.js': ['pkg/src/b.ts', 'pkg/src/own/generated/ids.json'],
};
const notices = () => render('@riftydev/pkg', collect(root, 'pkg', manifest, inputs).entries);
const files = () => ({
  'dist/a.js': `${LINK}\ncode`,
  'dist/b.js': 'own code',
  [NOTICES]: notices(),
});

describe('check:third-party-notices', () => {
  it('green: notices file derived from the bundler inputs, link line in the bundling file', () => {
    expect(built(inputs, files())()).toMatchObject({ entries: 2, violations: [] });
    expect(notices()).toContain('## dep@3.1.0');
    expect(notices()).toContain('MIT © Dep Authors');
    expect(notices()).toContain('## upstream@1.0.0');
    expect(notices()).toContain('Included as: generated into pkg/src/generated');
  });

  it('mutant: a package removed from the notices file → red', () => {
    const f = files();
    f[NOTICES] = f[NOTICES].replace(/## dep@3\.1\.0[\s\S]*?(?=## upstream)/u, '');
    expect(built(inputs, f)().violations).toEqual([
      '@riftydev/pkg dist/THIRD_PARTY_NOTICES.md differs from the bundler inputs; run pnpm build:libs',
    ]);
  });

  it('mutant: a newly inlined package with no license file and no record → red', () => {
    npmPkg('fresh', '0.1.0');
    const more = {
      ...inputs,
      'dist/a.js': [...inputs['dist/a.js'], 'node_modules/fresh/index.js'],
    };
    expect(built(more, files())().violations).toContain(
      '@riftydev/pkg fresh@0.1.0: no license file and no manifest record (bundled npm package)',
    );
  });

  it('a newly inlined package with its own LICENSE but a stale notices file → red', () => {
    npmPkg('fresh', '0.1.0', 'ISC © Fresh');
    const more = {
      ...inputs,
      'dist/a.js': [...inputs['dist/a.js'], 'node_modules/fresh/index.js'],
    };
    expect(built(more, files())().violations).toEqual([
      '@riftydev/pkg dist/THIRD_PARTY_NOTICES.md differs from the bundler inputs; run pnpm build:libs',
    ]);
  });

  it('mutant: a file in vendor/ without a manifest record → red (bundled or packed as is)', () => {
    put('pkg/vendor/lib.json', '{}');
    const more = { ...inputs, 'dist/a.js': [...inputs['dist/a.js'], 'pkg/vendor/lib.json'] };
    expect(built(more, files())().violations).toContain(
      '@riftydev/pkg pkg/vendor/lib.json: in pkg/vendor without a third-party-manifest record (pkg dist/a.js)',
    );
    const packedAsIs = { ...files(), 'vendor/lib.json': '{}' };
    expect(built(inputs, packedAsIs)().violations).toContain(
      '@riftydev/pkg pkg/vendor/lib.json: in pkg/vendor without a third-party-manifest record (pkg vendor/lib.json)',
    );
  });

  it('mutant: a new file in a recorded generated/ dir is not covered by the dir record → red', () => {
    put('pkg/src/generated/other.js', 'export default 2;');
    const more = { ...inputs, 'dist/a.js': [...inputs['dist/a.js'], 'pkg/src/generated/other.js'] };
    expect(built(more, files())().violations).toContain(
      '@riftydev/pkg pkg/src/generated/other.js: in pkg/src/generated without a third-party-manifest record (pkg dist/a.js)',
    );
  });

  it('a record covers exactly its own package: a manual record supplies only bare@2.0.0', () => {
    const more = { ...inputs, 'dist/b.js': [...inputs['dist/b.js'], 'node_modules/bare/index.js'] };
    const f = {
      ...files(),
      [NOTICES]: render('@riftydev/pkg', collect(root, 'pkg', manifest, more).entries),
    };
    f['dist/b.js'] = `${LINK}\n${f['dist/b.js']}`;
    expect(built(more, f)().violations).toEqual([]);
    expect(f[NOTICES]).toContain('MIT © Bare Author (from its README)');
  });

  it('bundling file without the link line, dist JS without an input list, stale or missing notices → red', () => {
    const f = { ...files(), 'dist/a.js': 'code', 'dist/c.js': 'x' };
    expect(built(inputs, f)().violations).toEqual([
      '@riftydev/pkg dist/c.js: not accounted — no bundler input list and not an own build output',
      '@riftydev/pkg dist/a.js: bundles third-party code without the notices link line',
    ]);
    const { [NOTICES]: _, ...noFile } = files();
    expect(built(inputs, noFile)().violations).toEqual([
      '@riftydev/pkg dist/THIRD_PARTY_NOTICES.md missing from the tarball',
    ]);
    const ownOnly = { 'dist/b.js': inputs['dist/b.js'] };
    expect(built(ownOnly, { 'dist/b.js': 'x', [NOTICES]: 'old' })().violations).toEqual([
      '@riftydev/pkg dist/THIRD_PARTY_NOTICES.md packed but nothing third-party is bundled',
    ]);
  });

  it('a generated dir pinned to another installed version → red', () => {
    put(
      'node_modules/upstream/package.json',
      JSON.stringify({ name: 'upstream', version: '1.1.0' }),
    );
    expect(collect(root, 'pkg', manifest, inputs).violations).toEqual([
      'pkg/src/generated: manifest pins upstream@1.0.0, installed 1.1.0',
    ]);
  });
});

describe('closed by default (review S1, S2)', () => {
  it('S1: any packed dist file without a bundler input list → red, not only JS', () => {
    const f = {
      ...files(),
      'dist/assets/brotli.wasm': '\0asm',
      'dist/a.d.ts': 'x',
      'dist/a.js.map': '{}',
    };
    expect(built(inputs, f)().violations).toEqual([
      '@riftydev/pkg dist/assets/brotli.wasm: not accounted — no bundler input list and not an own build output',
    ]);
  });

  it('S2: a manifest record no package used → red (npm, generated; firstParty is checked statically)', () => {
    const used = collect(root, 'pkg', manifest, inputs).used;
    expect(unusedRecords(manifest, [used])).toEqual(['npm bare@2.0.0']);
    const all = collect(root, 'pkg', manifest, { 'dist/a.js': ['pkg/src/a.ts'] }).used;
    expect(unusedRecords(manifest, [all])).toEqual([
      'npm bare@2.0.0',
      'generated pkg/src/generated',
    ]);
  });

  it('a generated record marked unshipped: unused is fine, used is red until the mark goes', () => {
    const marked = {
      ...manifest,
      generated: {
        'pkg/src/generated': {
          ...manifest.generated['pkg/src/generated'],
          unshipped: 'runtime-js/zlib-node-lib-port',
        },
      },
    };
    const none = collect(root, 'pkg', marked, { 'dist/a.js': ['pkg/src/a.ts'] }).used;
    expect(unusedRecords(marked, [none])).toEqual(['npm bare@2.0.0']);
    expect(shippedUnshipped(marked, [none])).toEqual([]);
    const used = collect(root, 'pkg', marked, inputs).used;
    expect(shippedUnshipped(marked, [used])).toEqual(['generated pkg/src/generated']);
  });

  it('S2: a renamed npm record no longer supplies its extra text — reported unused, not dropped silently', () => {
    const renamed = {
      ...manifest,
      npm: { 'dep@3.0.0': { licenseFiles: ['licenses/bare.LICENSE'] } },
    };
    const { used } = collect(root, 'pkg', renamed, inputs);
    expect(unusedRecords(renamed, [used])).toContain('npm dep@3.0.0');
  });

  it('link line without a packed notices file → red; package without dist → red', () => {
    const own = { 'dist/b.js': inputs['dist/b.js'] };
    expect(built(own, { 'dist/b.js': `${LINK}\nx` })().violations).toEqual([
      '@riftydev/pkg dist/b.js: links dist/THIRD_PARTY_NOTICES.md, which is not packed',
    ]);
    expect(built({}, { 'package.json': '{}', 'CHANGELOG.md': '' })().violations).toEqual([
      '@riftydev/pkg: no dist/ in the tarball; run pnpm build:libs',
    ]);
  });
});

describe('one accounting rule for every packed file (review 2)', () => {
  const NOT = 'not accounted — no bundler input list and not an own build output';
  it('own outputs: map of an accounted file, the notices file, declarations of own code', () => {
    const f = {
      ...files(),
      'dist/a.js.map': '{}',
      'dist/a.d.ts': "export * from './types-AB12cd34.js';",
      'dist/types-AB12cd34.d.ts': 'export type T = 1;',
    };
    expect(built(inputs, f)().violations).toEqual([]);
  });

  it('S1: a foreign .d.ts (no paired JS, not referenced by an own declaration) → red', () => {
    const f = { ...files(), 'dist/esbuild.d.ts': 'export declare function build(): void;' };
    expect(built(inputs, f)().violations).toEqual([`@riftydev/pkg dist/esbuild.d.ts: ${NOT}`]);
    const vendored = { ...files(), 'dist/vendor/review-semver.d.ts': 'export {};' };
    expect(built(inputs, vendored)().violations).toEqual([
      `@riftydev/pkg dist/vendor/review-semver.d.ts: ${NOT}`,
    ]);
  });

  it('S1: declarations are not own when tsup resolves dependency types into them', () => {
    put('pkg/tsup.config.ts', 'export default { dts: { resolve: true } };');
    const f = { ...files(), 'dist/a.d.ts': 'export {};' };
    expect(built(inputs, f)().violations).toEqual([`@riftydev/pkg dist/a.d.ts: ${NOT}`]);
  });

  it('S2: an input that is no file in the repo → red, not skipped', () => {
    const more = {
      ...inputs,
      'dist/a.js': [...inputs['dist/a.js'], 'webpack://dep/./src/index.ts'],
    };
    expect(built(more, files())().violations).toEqual([
      '@riftydev/pkg dist/a.js: input webpack://dep/./src/index.ts is not a file in the repo',
    ]);
    const abs = { ...inputs, 'dist/b.js': [...inputs['dist/b.js'], '../../home/ci/dep/src/x.ts'] };
    expect(built(abs, files())().violations).toEqual([
      '@riftydev/pkg dist/b.js: input ../../home/ci/dep/src/x.ts is not a file in the repo',
    ]);
  });

  it('files outside dist/ are their own inputs: own README is fine, a foreign one in vendor/ needs a record', () => {
    put('pkg/README.md', '# pkg');
    expect(built(inputs, { ...files(), 'README.md': '# pkg' })().violations).toEqual([]);
  });
});

describe('manifest records work or are red (review 2)', () => {
  it('S4: a record that adds no license text → red; ghost file; firstParty also in a generated record', () => {
    const m = {
      generated: {
        'pkg/src/generated': {
          files: ['up.js', 'ghost.js'],
          package: 'upstream',
          version: '1.0.0',
        },
        'pkg/src/node/generated': {
          files: ['legacy.js'],
          name: 'node',
          version: 'v1',
          license: 'MIT',
          licenseFiles: [],
        },
      },
      firstParty: ['pkg/src/generated/up.js'],
      npm: { 'bare@2.0.0': { licenseFiles: [] } },
    };
    put('pkg/src/node/generated/legacy.js', 'x');
    expect(validateManifest(root, m)).toEqual([
      'third-party-manifest generated pkg/src/generated: lists ghost.js, which is not in the dir',
      'third-party-manifest generated pkg/src/node/generated: adds no license text',
      'third-party-manifest npm bare@2.0.0: adds no license text',
      'third-party-manifest firstParty pkg/src/generated/up.js: also listed in generated pkg/src/generated',
    ]);
  });

  it('the real manifest validates; a mutated Node version or emptied licenseFiles → red', () => {
    const real = JSON.parse(readFileSync('tools/publishing/third-party-manifest.json', 'utf8'));
    expect(validateManifest(process.cwd(), real, publishableDirs(process.cwd()))).toEqual([]);
    const dir = 'packages/runtime-js/src/builtins/url-legacy/generated';
    const bumped = structuredClone(real);
    bumped.generated[dir].version = 'v24.99.0';
    expect(validateManifest(process.cwd(), bumped)).toEqual([
      `third-party-manifest generated ${dir}: version v24.99.0 is not sources.json "node" (v24.16.0)`,
    ]);
    const emptied = structuredClone(real);
    emptied.generated[dir].licenseFiles = [];
    emptied.npm['pako@1.0.11'].licenseFiles = [];
    expect(validateManifest(process.cwd(), emptied)).toEqual([
      `third-party-manifest generated ${dir}: adds no license text`,
      'third-party-manifest npm pako@1.0.11: adds no license text',
    ]);
  });
});

describe('closed list of packed-file categories (review 3)', () => {
  const NOT = 'not accounted — no bundler input list and not an own build output';
  it('(a) a recorded input list anywhere in the package is never overwritten', () => {
    const recorded = { ...inputs, 'bin/cli.js': ['node_modules/dep/index.js'] };
    const own = { 'dist/b.js': inputs['dist/b.js'], 'bin/cli.js': ['node_modules/dep/index.js'] };
    expect(built(own, { 'dist/b.js': 'x', 'bin/cli.js': 'x' })().violations).toContain(
      '@riftydev/pkg dist/THIRD_PARTY_NOTICES.md missing from the tarball',
    );
    expect(built(recorded, { ...files(), 'bin/cli.js': `${LINK}\nx` })().violations).toEqual([]);
  });

  it('(b) metadata only by fixed name at the package root; any other packed file → red', () => {
    const meta = {
      'package.json': '{}',
      'README.md': '',
      'CHANGELOG.md': '',
      LICENSE: '',
      'THIRD_PARTY_NOTICES.md': '',
    };
    expect(built(inputs, { ...files(), ...meta })().violations).toEqual([]);
    expect(
      built(inputs, { ...files(), 'docs/README.md': '', 'bin/x.js': '' })().violations,
    ).toEqual([`@riftydev/pkg docs/README.md: ${NOT}`, `@riftydev/pkg bin/x.js: ${NOT}`]);
  });

  it('(d) a map only next to its packed, accounted file (.js/.cjs/.mjs)', () => {
    const more = { ...inputs, 'dist/c.cjs': ['pkg/src/a.ts'] };
    const f = {
      ...files(),
      'dist/a.js.map': '{}',
      'dist/c.cjs': 'x',
      'dist/c.cjs.map': '{}',
      'dist/ghost.js.map': '{}',
    };
    expect(built(more, f)().violations).toEqual([`@riftydev/pkg dist/ghost.js.map: ${NOT}`]);
  });

  it('(e) only declarations reach declarations: an own .d.ts importing ./x.json does not own it', () => {
    const f = {
      ...files(),
      'dist/a.d.ts': "export type J = typeof import('./x.json');",
      'dist/x.json': '{}',
    };
    expect(built(inputs, f)().violations).toEqual([`@riftydev/pkg dist/x.json: ${NOT}`]);
  });

  it('(c) every file of a vendor/generated dir is in a record or firstParty, any extension', () => {
    put('pkg/src/generated/up.LICENSE', 'MIT');
    put('pkg/src/vendor/review-x.d.ts', 'export {};');
    const m = {
      ...manifest,
      generated: {
        'pkg/src/generated': {
          ...manifest.generated['pkg/src/generated'],
          files: ['up.js', 'up.LICENSE'],
        },
      },
    };
    expect(validateManifest(root, m, ['pkg'])).toEqual([
      'third-party-manifest: pkg/src/vendor/review-x.d.ts is in no record and not firstParty',
    ]);
  });
});

describe('manifest records (review 3)', () => {
  it('an npm record needs non-empty licenseFiles with non-empty texts', () => {
    put('licenses/empty.LICENSE', '');
    const m = {
      ...manifest,
      npm: { 'bare@2.0.0': {}, 'dep@3.1.0': { licenseFiles: ['licenses/empty.LICENSE'] } },
    };
    expect(validateManifest(root, m, [])).toEqual([
      'third-party-manifest npm bare@2.0.0: adds no license text',
      'third-party-manifest npm dep@3.1.0: adds no license text',
    ]);
  });

  it('a generated version is compared with one named key of sources.json', () => {
    put('pkg/src/generated/sources.json', JSON.stringify({ version: '0.28.0', node: 'v24.16.0' }));
    const at = (version: string, sourcesKey?: string) => ({
      ...manifest,
      generated: {
        'pkg/src/generated': {
          ...manifest.generated['pkg/src/generated'],
          files: ['up.js', 'sources.json'],
          version,
          sourcesKey,
        },
      },
    });
    expect(validateManifest(root, at('v24.16.0', 'node'), [])).toEqual([]);
    expect(validateManifest(root, at('0.28.0', 'node'), [])).toEqual([
      'third-party-manifest generated pkg/src/generated: version 0.28.0 is not sources.json "node" (v24.16.0)',
    ]);
    expect(validateManifest(root, at('0.28.0'), [])).toEqual([
      'third-party-manifest generated pkg/src/generated: has sources.json but no sourcesKey',
    ]);
  });

  it('a dotted sourcesKey names a nested pin of sources.json', () => {
    put(
      'pkg/src/generated/sources.json',
      JSON.stringify({ node: { version: 'v24.16.0', sha256: 'ab' } }),
    );
    const at = (version: string) => ({
      ...manifest,
      generated: {
        'pkg/src/generated': {
          ...manifest.generated['pkg/src/generated'],
          files: ['up.js', 'sources.json'],
          version,
          sourcesKey: 'node.version',
        },
      },
    });
    expect(validateManifest(root, at('v24.16.0'), [])).toEqual([]);
    expect(validateManifest(root, at('v22.0.0'), [])).toEqual([
      'third-party-manifest generated pkg/src/generated: version v22.0.0 is not sources.json "node.version" (v24.16.0)',
    ]);
  });
});

describe('review 4', () => {
  const NOT = 'not accounted — no bundler input list and not an own build output';
  const dts = () => ({ ...files(), 'dist/a.d.ts': 'export {};' });

  it('(e) dts resolve through an identifier or the CLI flag → declarations are not own', () => {
    put('pkg/tsup.config.ts', "const resolve = ['esbuild'];\nexport default { dts: { resolve } };");
    expect(built(inputs, dts())().violations).toEqual([`@riftydev/pkg dist/a.d.ts: ${NOT}`]);
    put('pkg/tsup.config.ts', 'export default { dts: true };');
    put('pkg/package.json', JSON.stringify({ scripts: { build: 'tsup --dts-resolve' } }));
    expect(built(inputs, dts())().violations).toEqual([`@riftydev/pkg dist/a.d.ts: ${NOT}`]);
  });

  it('(e) the word resolve in a comment is no resolve option', () => {
    put(
      'pkg/tsup.config.ts',
      '// no on-disk package to `require.\n// resolve`\n/* resolve */\nexport default { dts: true };',
    );
    expect(built(inputs, dts())().violations).toEqual([]);
  });

  it('(b) metadata names are exact: README.js, LICENSE.wasm → red', () => {
    const f = {
      ...files(),
      'README.txt': '',
      'LICENSE.md': '',
      'README.js': '',
      'LICENSE.wasm': '',
    };
    expect(built(inputs, f)().violations).toEqual([
      `@riftydev/pkg README.js: ${NOT}`,
      `@riftydev/pkg LICENSE.wasm: ${NOT}`,
    ]);
  });

  it('(a)/(d) maps anywhere in the packed dirs, .js/.cjs/.mjs, give input lists', () => {
    put('pkg/package.json', JSON.stringify({ files: ['dist', 'bin'] }));
    put('pkg/dist/c.mjs.map', JSON.stringify({ sources: ['../src/a.ts'] }));
    put('pkg/bin/cli.cjs.map', JSON.stringify({ sources: ['../../node_modules/dep/index.js'] }));
    expect(bundleInputs(root, 'pkg')).toEqual({
      'dist/c.mjs': ['pkg/src/a.ts'],
      'bin/cli.cjs': ['node_modules/dep/index.js'],
    });
  });

  it('(c) vendor/generated dirs are walked recursively; files match by path inside the dir', () => {
    put('pkg/src/generated/sub/deep.js', 'x');
    expect(validateManifest(root, manifest, ['pkg'])).toEqual([
      'third-party-manifest: pkg/src/generated/sub/deep.js is in no record and not firstParty',
    ]);
    const m = {
      ...manifest,
      generated: {
        'pkg/src/generated': {
          ...manifest.generated['pkg/src/generated'],
          files: ['up.js', 'sub/deep.js'],
        },
      },
    };
    expect(validateManifest(root, m, ['pkg'])).toEqual([]);
    const more = { 'dist/a.js': ['pkg/src/generated/sub/deep.js'] };
    expect(collect(root, 'pkg', m, more).violations).toEqual([]);
    expect(collect(root, 'pkg', manifest, more).violations).toEqual([
      'pkg/src/generated/sub/deep.js: in pkg/src/generated without a third-party-manifest record (pkg dist/a.js)',
    ]);
  });
});

describe('repo manifest', () => {
  it("non-npm upstream: Node's url-legacy record yields node@v24.16.0 with Node's LICENSE", () => {
    const real = JSON.parse(readFileSync('tools/publishing/third-party-manifest.json', 'utf8'));
    const { entries, violations } = collect(process.cwd(), 'packages/runtime-js', real, {
      'dist/x.js': ['packages/runtime-js/src/builtins/url-legacy/generated/legacy.js'],
    });
    expect(violations).toEqual([]);
    const text = render('@riftydev/runtime-js', entries);
    expect(entries.map((e: { id: string }) => e.id)).toEqual(['node@v24.16.0']);
    expect(text).toContain('Copyright Node.js contributors. All rights reserved.');
    expect(text).toContain('generated into packages/runtime-js/src/builtins/url-legacy/generated');
  });

  it('every manual license file exists', () => {
    const m = JSON.parse(readFileSync('tools/publishing/third-party-manifest.json', 'utf8'));
    for (const record of Object.values(m.npm) as { licenseFiles: string[] }[])
      for (const f of record.licenseFiles)
        expect(readFileSync(f, 'utf8').length).toBeGreaterThan(100);
  });
});
