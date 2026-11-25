import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LINK,
  NOTICES,
  collect,
  render,
  unusedRecords,
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
      '@riftydev/pkg dist/c.js: no bundler input list',
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

  it('a generated dir from a non-npm upstream takes name, version and texts from its record', () => {
    put('pkg/src/node/generated/legacy.js', 'export default 3;');
    put('licenses/node.LICENSE', 'Copyright Node.js contributors. MIT');
    const m = {
      ...manifest,
      generated: {
        ...manifest.generated,
        'pkg/src/node/generated': {
          files: ['legacy.js'],
          name: 'node',
          version: 'v24.16.0',
          license: 'MIT',
          licenseFiles: ['licenses/node.LICENSE'],
        },
      },
    };
    const { entries, violations } = collect(root, 'pkg', m, {
      'dist/a.js': ['pkg/src/node/generated/legacy.js'],
    });
    expect(violations).toEqual([]);
    expect(render('@riftydev/pkg', entries)).toContain('## node@v24.16.0');
    expect(render('@riftydev/pkg', entries)).toContain('Copyright Node.js contributors. MIT');
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
      '@riftydev/pkg dist/assets/brotli.wasm: no bundler input list',
    ]);
  });

  it('S2: a manifest record no package used → red (npm, generated, firstParty)', () => {
    const used = collect(root, 'pkg', manifest, inputs).used;
    expect(unusedRecords(manifest, [used])).toEqual(['npm bare@2.0.0']);
    const all = collect(root, 'pkg', manifest, { 'dist/a.js': ['pkg/src/a.ts'] }).used;
    expect(unusedRecords(manifest, [all])).toEqual([
      'npm bare@2.0.0',
      'generated pkg/src/generated',
      'firstParty pkg/src/own/generated/ids.json',
    ]);
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

describe('repo manifest', () => {
  it('every manual license file exists', () => {
    const m = JSON.parse(readFileSync('tools/publishing/third-party-manifest.json', 'utf8'));
    for (const record of Object.values(m.npm) as { licenseFiles: string[] }[])
      for (const f of record.licenseFiles)
        expect(readFileSync(f, 'utf8').length).toBeGreaterThan(100);
  });
});
