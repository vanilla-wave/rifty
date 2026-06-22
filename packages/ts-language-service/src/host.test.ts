import { createMemoryFs } from '@riftydev/vfs/internal';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createVfsLanguageServiceHost } from './host.ts';
import { loadLibDts } from './lib-dts.ts';
import { createDocumentOverlay } from './overlay.ts';

function writeFile(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  path: string,
  text: string,
) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path, new TextEncoder().encode(text));
}

describe('createVfsLanguageServiceHost', () => {
  it('drives ts.createLanguageService to a single type error mentioning string/number', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/a.ts', 'const x: number = "s";\n');
    const libMap = await loadLibDts();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay: createDocumentOverlay(),
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    const diags = service.getSemanticDiagnostics('/proj/a.ts');
    expect(diags).toHaveLength(1);
    const msg = ts.flattenDiagnosticMessageText(diags[0]?.messageText, '\n');
    expect(msg).toMatch(/string/);
    expect(msg).toMatch(/number/);
  });

  it('serves lib types (Array, Promise) so std-lib globals resolve', async () => {
    const { fsSync } = createMemoryFs();
    // Uses Array + Promise; with libs served there must be ZERO errors.
    writeFile(
      fsSync,
      '/proj/a.ts',
      'const xs: Array<number> = [1, 2];\nconst p: Promise<number> = Promise.resolve(xs.length);\n',
    );
    const libMap = await loadLibDts();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: { ...ts.getDefaultCompilerOptions(), target: ts.ScriptTarget.ES2017 },
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay: createDocumentOverlay(),
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);
  });

  it('does not shadow a project file whose basename collides with a std-lib name', async () => {
    const { fsSync } = createMemoryFs();
    // A project file named like a std lib must be served from the VFS, never
    // from the lib map — lib serving is scoped to the synthetic /ts-lib/ dir.
    const projLib = '/proj/lib.dom.d.ts';
    writeFile(fsSync, projLib, 'export const RIFTY_PROJECT_MARKER = 1;\n');
    const libMap = await loadLibDts();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: [projLib],
      libMap,
      overlay: createDocumentOverlay(),
    });

    expect(host.readFile?.(projLib)).toContain('RIFTY_PROJECT_MARKER');
    // The real std lib is still served under the synthetic dir.
    expect(host.readFile?.('/ts-lib/lib.es5.d.ts')).toContain('interface Array<T>');
  });
});
