import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from './lsp-types.ts';
import { createTsLanguageService } from './service.ts';

function writeFile(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  path: string,
  text: string,
) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path, new TextEncoder().encode(text));
}

describe('createTsLanguageService → LSP diagnostics', () => {
  it('maps a semantic error to an LSP Diagnostic with 0-based range, severity, code, source', async () => {
    const { fsSync } = createMemoryFs();
    // TS2322 anchors on the variable binding `x` (char 6), not the initializer.
    //   const x: number = "s";
    //   0123456^x
    writeFile(fsSync, '/proj/tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
    writeFile(fsSync, '/proj/a.ts', 'const x: number = "s";\n');

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/proj' });
    const diags = svc.getSemanticDiagnostics('/proj/a.ts');

    expect(diags).toHaveLength(1);
    const d = diags[0];
    if (!d) throw new Error('no diagnostic');
    expect(d.source).toBe('ts');
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(typeof d.code).toBe('number');
    expect(d.code).toBe(2322); // Type 'string' is not assignable to type 'number'.
    expect(d.message).toMatch(/not assignable/);
    // Range is 0-based and covers the `x` binding (char 6, length 1).
    expect(d.range.start).toEqual({ line: 0, character: 6 });
    expect(d.range.end).toEqual({ line: 0, character: 7 });
  });

  it('getSyntacticDiagnostics returns a parse error as an LSP Diagnostic', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/a.ts', 'const x = ;\n'); // missing expression → parse error

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/proj' });
    const diags = svc.getSyntacticDiagnostics('/proj/a.ts');

    expect(diags.length).toBeGreaterThanOrEqual(1);
    const d = diags[0];
    if (!d) throw new Error('no diagnostic');
    expect(d.source).toBe('ts');
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(typeof d.code).toBe('number');
  });

  it('open/update/close documents drive diagnostics without a VFS write', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
    writeFile(fsSync, '/proj/a.ts', 'export const x: number = 1;\n');

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/proj' });
    expect(svc.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);

    svc.openDocument('/proj/a.ts', 'export const x: number = "bad";\n');
    expect(svc.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(1);

    svc.updateDocument('/proj/a.ts', 'export const x: number = 2;\n');
    expect(svc.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);

    svc.closeDocument('/proj/a.ts');
    expect(svc.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);
    // On-disk bytes untouched.
    expect(new TextDecoder().decode(fsSync.readFileBytesSync('/proj/a.ts'))).toBe(
      'export const x: number = 1;\n',
    );
  });

  it('a path outside the program is honest-empty, never a "Could not find source file" throw', async () => {
    const { fsSync } = createMemoryFs();
    // The default playground project: a `.js` entry, NO tsconfig — so `allowJs`
    // defaults to false and `main.js` is OPENED in the editor but never enters
    // the TS program. The raw `ts.LanguageService` throws "Could not find source
    // file" for a path it has no SourceFile for; the editor wants what real
    // tsserver gives a file outside the project — nothing — NOT a crash.
    writeFile(fsSync, '/workspace/src/main.js', 'export const x = 1;\n');

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/workspace' });
    svc.openDocument('/workspace/src/main.js', 'export const x = 1;\n');

    // Diagnostics: empty, not a throw (the exact CI crash on `/workspace/src/main.js`).
    expect(svc.getSemanticDiagnostics('/workspace/src/main.js')).toEqual([]);
    expect(svc.getSyntacticDiagnostics('/workspace/src/main.js')).toEqual([]);
    // A path neither opened nor in any tsconfig: also empty, not a throw.
    expect(svc.getSemanticDiagnostics('/workspace/never-seen.ts')).toEqual([]);
    // Position queries on an out-of-program file are honest-empty too.
    expect(svc.getQuickInfo('/workspace/src/main.js', { line: 0, character: 13 })).toBeNull();
    expect(svc.getDefinition('/workspace/src/main.js', { line: 0, character: 13 })).toEqual([]);
    expect(svc.getCompletions('/workspace/src/main.js', { line: 0, character: 0 }).items).toEqual(
      [],
    );
  });
});
