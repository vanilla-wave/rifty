import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { loadTsConfig } from './tsconfig.ts';

function writeFile(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  path: string,
  text: string,
) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path, new TextEncoder().encode(text));
}

describe('loadTsConfig over VFS', () => {
  it('honors a tsconfig: strict + noUnusedLocals parsed true', () => {
    const { fsSync } = createMemoryFs();
    writeFile(
      fsSync,
      '/proj/tsconfig.json',
      JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
    );
    writeFile(fsSync, '/proj/a.ts', 'function f() { const unused = 1; }\n');

    const parsed = loadTsConfig(fsSync, '/proj');
    expect(parsed.options.strict).toBe(true);
    expect(parsed.options.noUnusedLocals).toBe(true);
    // The include glob must have discovered the .ts file.
    expect(parsed.fileNames).toContain('/proj/a.ts');
  });

  it('no tsconfig → defaults (no strict) but still discovers loose files', () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/a.ts', 'const x = 1;\n');

    const parsed = loadTsConfig(fsSync, '/proj');
    expect(parsed.options.strict).toBeUndefined();
    expect(parsed.fileNames).toContain('/proj/a.ts');
  });

  it('respects an explicit files array', () => {
    const { fsSync } = createMemoryFs();
    writeFile(
      fsSync,
      '/proj/tsconfig.json',
      JSON.stringify({ files: ['a.ts'], compilerOptions: {} }),
    );
    writeFile(fsSync, '/proj/a.ts', 'const x = 1;\n');
    writeFile(fsSync, '/proj/b.ts', 'const y = 2;\n');

    const parsed = loadTsConfig(fsSync, '/proj');
    expect(parsed.fileNames).toContain('/proj/a.ts');
    expect(parsed.fileNames).not.toContain('/proj/b.ts');
  });
});
