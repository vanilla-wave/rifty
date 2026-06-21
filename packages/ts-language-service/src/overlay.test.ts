import type { FsSync } from '@riftydev/vfs';
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

function readVfs(fsSync: ReturnType<typeof createMemoryFs>['fsSync'], path: string): string {
  return new TextDecoder().decode(fsSync.readFileBytesSync(path));
}

describe('open-document overlay drives diagnostics without touching the VFS', () => {
  it('open valid → 0, update to error → 1, update back → 0; VFS bytes never change', async () => {
    const { fsSync } = createMemoryFs();
    const VALID = 'export const x: number = 1;\n';
    writeFile(fsSync, '/proj/a.ts', VALID);
    const libMap = await loadLibDts();
    const overlay = createDocumentOverlay();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay,
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    overlay.open('/proj/a.ts', VALID);
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);

    overlay.update('/proj/a.ts', 'export const x: number = "oops";\n');
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(1);

    overlay.update('/proj/a.ts', VALID);
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);

    // The on-disk bytes were never rewritten — the overlay is the only buffer.
    expect(readVfs(fsSync, '/proj/a.ts')).toBe(VALID);
  });

  it('a freshly opened file not on disk is visible to the service', async () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/proj', { recursive: true });
    const libMap = await loadLibDts();
    const overlay = createDocumentOverlay();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: [], // nothing on disk / in tsconfig yet
      libMap,
      overlay,
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    overlay.open('/proj/untitled.ts', 'const x: number = "no";\n');
    const diags = service.getSemanticDiagnostics('/proj/untitled.ts');
    expect(diags).toHaveLength(1);
    expect(fsSync.existsSync('/proj/untitled.ts')).toBe(false);
  });

  it('close drops the overlay buffer back to the VFS bytes', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/a.ts', 'export const x: number = 1;\n');
    const libMap = await loadLibDts();
    const overlay = createDocumentOverlay();

    const host = createVfsLanguageServiceHost({
      fsSync,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay,
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());

    overlay.open('/proj/a.ts', 'export const x: number = "bad";\n');
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(1);

    overlay.close('/proj/a.ts');
    // Back to the (valid) on-disk content.
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);
  });

  it('invalidate forces a re-read when the backend stat cannot change (frozen mtime/size)', async () => {
    const { fsSync: real } = createMemoryFs();
    writeFile(real, '/proj/a.ts', 'export const x: number = 1;\n');
    const libMap = await loadLibDts();
    const overlay = createDocumentOverlay();

    // A backend whose stat (mtime+size) is FROZEN — the vfsVersion token can
    // never move, so only `invalidate` can tell TS the bytes changed. This is
    // the OPFS-like case the invalidate signal exists for. Delegate every method
    // to the real backend; override only stat to freeze the token.
    const FROZEN = { isFile: true, isDirectory: false, size: 28, mtime: 1000 };
    const frozen: FsSync = {
      existsSync: (p) => real.existsSync(p),
      readFileBytesSync: (p) => real.readFileBytesSync(p),
      writeFileSync: (p, d) => real.writeFileSync(p, d),
      readdirSync: (p) => real.readdirSync(p),
      mkdirSync: (p, o) => real.mkdirSync(p, o),
      rmSync: (p, o) => real.rmSync(p, o),
      utimes: (p, a, m) => real.utimes(p, a, m),
      copyFileSync: (s, d) => real.copyFileSync(s, d),
      cpSync: (s, d, o) => real.cpSync(s, d, o),
      renameSync: (s, d) => real.renameSync(s, d),
      statSync: (p) => (p === '/proj/a.ts' ? FROZEN : real.statSync(p)),
      statSyncOrNull: (p) => (p === '/proj/a.ts' ? FROZEN : real.statSyncOrNull(p)),
    };

    const host = createVfsLanguageServiceHost({
      fsSync: frozen,
      projectRoot: '/proj',
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: ['/proj/a.ts'],
      libMap,
      overlay,
    });
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(0);

    // External write to an error; stat stays frozen → TS would keep the stale
    // snapshot until told otherwise.
    writeFile(real, '/proj/a.ts', 'export const x: number = "z";\n');
    overlay.invalidate('/proj/a.ts');
    expect(service.getSemanticDiagnostics('/proj/a.ts')).toHaveLength(1);
  });
});
