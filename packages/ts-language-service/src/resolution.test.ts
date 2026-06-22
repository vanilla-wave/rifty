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

describe('module resolution over the VFS node_modules', () => {
  it('resolves a node_modules .d.ts and type-checks against it', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(
      fsSync,
      '/proj/node_modules/leftpad/package.json',
      JSON.stringify({ name: 'leftpad', types: 'index.d.ts' }),
    );
    writeFile(
      fsSync,
      '/proj/node_modules/leftpad/index.d.ts',
      'export function leftpad(s: string, n: number): string;\n',
    );
    writeFile(fsSync, '/proj/a.ts', "import { leftpad } from 'leftpad';\nleftpad(1, 2);\n");
    const libMap = await loadLibDts();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: {
        ...ts.getDefaultCompilerOptions(),
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay: createDocumentOverlay(),
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    const diags = service.getSemanticDiagnostics('/proj/a.ts');
    // Exactly one error: the `1` passed where a string is expected (NOT an
    // "unresolved module" error — that would prove resolution failed).
    expect(diags).toHaveLength(1);
    const msg = ts.flattenDiagnosticMessageText(diags[0]?.messageText, '\n');
    expect(msg).toMatch(/string/);
    expect(msg).not.toMatch(/Cannot find module/);
    // Argument-type error code, proving the signature was actually consulted.
    expect(diags[0]?.code).toBe(2345);
  });

  it('routes resolution through the host resolveModuleNameLiterals hook', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(
      fsSync,
      '/proj/node_modules/leftpad/package.json',
      JSON.stringify({ name: 'leftpad', types: 'index.d.ts' }),
    );
    writeFile(
      fsSync,
      '/proj/node_modules/leftpad/index.d.ts',
      'export function leftpad(s: string, n: number): string;\n',
    );
    writeFile(fsSync, '/proj/a.ts', "import { leftpad } from 'leftpad';\nleftpad('x', 2);\n");
    const libMap = await loadLibDts();

    // Record every module literal MY resolver resolves (only the explicit
    // resolveModuleNameLiterals hook calls this — TS's internal fallback never
    // would).
    const resolved: Array<{ name: string; to: string | undefined }> = [];
    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: {
        ...ts.getDefaultCompilerOptions(),
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay: createDocumentOverlay(),
      onModuleResolved: (name, _from, to) => resolved.push({ name, to }),
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    service.getSemanticDiagnostics('/proj/a.ts');

    expect(resolved).toContainEqual({
      name: 'leftpad',
      to: '/proj/node_modules/leftpad/index.d.ts',
    });
  });
});
