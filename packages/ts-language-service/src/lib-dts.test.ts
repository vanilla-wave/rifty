import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
// Namespace import: `resolveWorkspaceTypeScriptEntry` is the feature under test.
import * as libDts from './lib-dts.js';
import { TS_LIB_URL_ENV, getTsLibUrl, loadLibDts } from './lib-dts.js';
import { writeRealWorkspaceTypeScript } from './test-workspace-typescript.ts';

const nodeRequire = createRequire(import.meta.url);
const REAL_TS_VERSION = (nodeRequire('typescript/package.json') as { version: string }).version;
const enc = new TextEncoder();

describe('loadLibDts (Node-direct read)', () => {
  it('returns a Map of lib.*.d.ts → contents from the installed compiler', async () => {
    const libs = await loadLibDts();
    expect(libs).toBeInstanceOf(Map);
    expect(libs.size).toBeGreaterThan(0);

    // Stable structural markers from the pinned TypeScript std lib.
    const es5 = libs.get('lib.es5.d.ts');
    expect(es5, 'lib.es5.d.ts present').toBeDefined();
    expect(es5).toContain('interface Array<T>');

    const promise = libs.get('lib.es2015.promise.d.ts');
    expect(promise, 'lib.es2015.promise.d.ts present').toBeDefined();
    expect(promise).toContain('interface PromiseConstructor');

    // The default lib aggregator must be present (host's getDefaultLibFileName).
    expect(libs.has('lib.d.ts')).toBe(true);
  });

  it('memoizes — repeat calls return the same Map instance', async () => {
    const a = await loadLibDts();
    const b = await loadLibDts();
    expect(a).toBe(b);
  });
});

describe('loadTypeScriptCompilerForProject (Node resolution semantics)', () => {
  it('stock layout resolves the identical lib/typescript.js entry as the legacy probe', async () => {
    const { fsSync } = createMemoryFs();
    writeRealWorkspaceTypeScript(fsSync, '/proj');

    const entry = await libDts.resolveWorkspaceTypeScriptEntry(fsSync, '/proj');
    expect(entry.entryPath).toBe('/proj/node_modules/typescript/lib/typescript.js');
    expect(entry.packageRoot).toBe('/proj/node_modules/typescript');
  });

  it('relocated entry (package.json main → dist/typescript.js) resolves and loads', async () => {
    const { fsSync } = createMemoryFs();
    writeRealWorkspaceTypeScript(fsSync, '/proj', {
      entryDir: 'dist',
      packageJsonText: JSON.stringify({
        name: 'typescript',
        version: REAL_TS_VERSION,
        main: './dist/typescript.js',
      }),
    });

    const compiler = await libDts.loadTypeScriptCompilerForProject(fsSync, '/proj');
    expect(compiler.ts.version).toBe(REAL_TS_VERSION);
    expect(compiler.packageRoot).toBe('/proj/node_modules/typescript');
    // Lib set travels with the entry (tsc reads libs next to the executing file).
    expect(compiler.libMap.has('lib.d.ts')).toBe(true);
    expect(compiler.libMap.get('lib.es5.d.ts')).toContain('interface Array<T>');
  });

  it('exports-field entry (conditional object) resolves and loads', async () => {
    const { fsSync } = createMemoryFs();
    writeRealWorkspaceTypeScript(fsSync, '/proj', {
      entryDir: 'out',
      packageJsonText: JSON.stringify({
        name: 'typescript',
        version: REAL_TS_VERSION,
        exports: {
          '.': { node: './out/typescript.js', default: './out/typescript.js' },
          './package.json': './package.json',
        },
      }),
    });

    const compiler = await libDts.loadTypeScriptCompilerForProject(fsSync, '/proj');
    expect(compiler.ts.version).toBe(REAL_TS_VERSION);
    expect(compiler.libMap.has('lib.d.ts')).toBe(true);
  });

  it('hoisted node_modules: nested project dir resolves the workspace-root install', async () => {
    const { fsSync } = createMemoryFs();
    writeRealWorkspaceTypeScript(fsSync, '/workspace');
    fsSync.mkdirSync('/workspace/apps/web', { recursive: true });

    const entry = await libDts.resolveWorkspaceTypeScriptEntry(fsSync, '/workspace/apps/web');
    expect(entry.entryPath).toBe('/workspace/node_modules/typescript/lib/typescript.js');
  });

  it('absent package fails loudly: "TypeScript is not installed"', async () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/proj', { recursive: true });

    await expect(libDts.loadTypeScriptCompilerForProject(fsSync, '/proj')).rejects.toThrow(
      'TypeScript is not installed in this project; run npm install -D typescript',
    );
  });

  it('package present but no resolvable entry fails loudly naming the package dir', async () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/proj/node_modules/typescript', { recursive: true });
    fsSync.writeFileSync(
      '/proj/node_modules/typescript/package.json',
      enc.encode(JSON.stringify({ name: 'typescript', version: '0.0.0-broken' })),
    );

    await expect(libDts.loadTypeScriptCompilerForProject(fsSync, '/proj')).rejects.toThrow(
      'workspace TypeScript at /proj/node_modules/typescript has no resolvable compiler entry',
    );
  });

  it('resolved-but-non-compiler module still fails the API duck-check loudly', async () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/proj/node_modules/typescript/dist', { recursive: true });
    fsSync.writeFileSync(
      '/proj/node_modules/typescript/package.json',
      enc.encode(
        JSON.stringify({ name: 'typescript', version: '0.0.0', main: './dist/typescript.js' }),
      ),
    );
    fsSync.writeFileSync(
      '/proj/node_modules/typescript/dist/typescript.js',
      enc.encode('module.exports = { version: "0.0.0" };\n'),
    );

    await expect(libDts.loadTypeScriptCompilerForProject(fsSync, '/proj')).rejects.toThrow(
      'did not export a compiler API',
    );
  });
});

describe('parity: workspace entry resolution ≡ Node require.resolve("typescript")', () => {
  interface Layout {
    readonly name: string;
    readonly packageJson: Record<string, unknown>;
    readonly files: readonly string[];
  }
  const LAYOUTS: readonly Layout[] = [
    {
      name: 'stock main → lib/typescript.js',
      packageJson: { name: 'typescript', version: '0.0.0-test', main: './lib/typescript.js' },
      files: ['lib/typescript.js'],
    },
    {
      name: 'relocated main → dist/typescript.js',
      packageJson: { name: 'typescript', version: '0.0.0-test', main: './dist/typescript.js' },
      files: ['dist/typescript.js'],
    },
    {
      name: 'exports string form',
      packageJson: { name: 'typescript', version: '0.0.0-test', exports: './out/typescript.js' },
      files: ['out/typescript.js'],
    },
    {
      name: 'exports conditional object',
      packageJson: {
        name: 'typescript',
        version: '0.0.0-test',
        exports: { '.': { node: './out/typescript.js', default: './out/typescript.js' } },
      },
      files: ['out/typescript.js'],
    },
    {
      name: 'no main/exports → index.js directory fallback',
      packageJson: { name: 'typescript', version: '0.0.0-test' },
      files: ['index.js'],
    },
  ];

  for (const layout of LAYOUTS) {
    it(layout.name, async () => {
      // Real-FS twin: what Node itself resolves for this layout. realpath —
      // macOS tmpdir is a symlink (/var → /private/var) and require.resolve
      // returns real paths.
      const tmp = realpathSync(mkdtempSync(nodePath.join(tmpdir(), 'rifty-ts-resolve-')));
      try {
        const pkgDir = nodePath.join(tmp, 'node_modules', 'typescript');
        for (const rel of layout.files) {
          mkdirSync(nodePath.dirname(nodePath.join(pkgDir, rel)), { recursive: true });
          writeFileSync(nodePath.join(pkgDir, rel), 'module.exports = {};\n');
        }
        writeFileSync(nodePath.join(pkgDir, 'package.json'), JSON.stringify(layout.packageJson));
        const nodeEntry = createRequire(nodePath.join(tmp, 'probe.js')).resolve('typescript');
        const nodeRel = nodePath.relative(tmp, nodeEntry).split(nodePath.sep).join('/');

        // Memory-VFS twin: same tree, rifty's resolution.
        const { fsSync } = createMemoryFs();
        for (const rel of layout.files) {
          const abs = `/proj/node_modules/typescript/${rel}`;
          fsSync.mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
          fsSync.writeFileSync(abs, enc.encode('module.exports = {};\n'));
        }
        fsSync.writeFileSync(
          '/proj/node_modules/typescript/package.json',
          enc.encode(JSON.stringify(layout.packageJson)),
        );

        const entry = await libDts.resolveWorkspaceTypeScriptEntry(fsSync, '/proj');
        expect(entry.entryPath.slice('/proj/'.length)).toBe(nodeRel);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('getTsLibUrl (env-config precedence — D-004)', () => {
  it('defaults to /ts-lib/lib-bundle.json when nothing is configured', () => {
    expect(getTsLibUrl()).toBe('/ts-lib/lib-bundle.json');
  });

  it('prefers the bootstrap global over the default', () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g[TS_LIB_URL_ENV];
    g[TS_LIB_URL_ENV] = 'https://cdn.example/lib-bundle.json';
    try {
      expect(getTsLibUrl()).toBe('https://cdn.example/lib-bundle.json');
    } finally {
      if (prev === undefined) delete g[TS_LIB_URL_ENV];
      else g[TS_LIB_URL_ENV] = prev;
    }
  });
});
