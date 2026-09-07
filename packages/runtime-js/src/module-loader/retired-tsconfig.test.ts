import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';
import { createResolver } from './resolver.ts';

describe('retired automatic tsconfig discovery (ADR-0380)', () => {
  it('rejects a JavaScript caller still enabling the removed loader option', () => {
    const options = { cwd: '/work', autoDiscoverTsconfigPaths: true };
    expect(() => createModuleLoader(new MemoryFsSync(), options)).toThrow(
      /runtime-js.auto-discover-tsconfig-paths/u,
    );
  });

  it('rejects the same obsolete option at the resolver boundary, even with explicit paths', () => {
    const options = { paths: { '@/*': '/work/*' }, autoDiscoverTsconfigPaths: true };
    expect(() => createResolver(new MemoryFsSync(), options)).toThrow(
      /runtime-js.auto-discover-tsconfig-paths/u,
    );
  });
});
