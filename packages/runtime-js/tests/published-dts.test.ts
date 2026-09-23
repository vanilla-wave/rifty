/**
 * Published `@riftydev/runtime-js` types compile standalone: the package's own
 * tsup d.ts build (only `outDir` redirected) type-checks for a consumer without
 * `@types/node` and with `skipLibCheck: false`. The d.ts bundle keeps a
 * `declare global` only from an entry module — moving `NodeJS.ErrnoException`
 * out of `fs.ts` left `builtins/fs.d.ts` with 9× TS2503 (review 2026-09-23).
 * Only diagnostics in the emitted files count; `@riftydev/*` siblings resolve
 * through the workspace like any consumer import.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsupCli = join(dirname(require.resolve('tsup/package.json')), 'dist/cli-default.js');

function dtsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return dtsFiles(path);
    return path.endsWith('.d.ts') ? [path] : [];
  });
}

it('every published d.ts type-checks without @types/node', () => {
  // Inside the package so bare `@riftydev/*` imports resolve via its node_modules.
  const cacheDir = join(pkgDir, 'node_modules/.cache');
  mkdirSync(cacheDir, { recursive: true });
  const outDir = mkdtempSync(join(cacheDir, 'published-dts-'));
  try {
    execFileSync(process.execPath, [tsupCli, '--dts-only', '--out-dir', outDir], {
      cwd: pkgDir,
      stdio: 'pipe',
    });
    const files = dtsFiles(outDir);
    expect(files.map((f) => f.slice(outDir.length))).toContain('/builtins/fs.d.ts');
    const program = ts.createProgram(files, {
      noEmit: true,
      types: [],
      skipLibCheck: false,
      strict: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      allowImportingTsExtensions: true,
    });
    const own = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName.startsWith(outDir))
      .map((d) => {
        const at = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
        const where = `${d.file?.fileName.slice(outDir.length)}:${(at?.line ?? 0) + 1}`;
        return `${where} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    expect(own).toEqual([]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 180_000);
