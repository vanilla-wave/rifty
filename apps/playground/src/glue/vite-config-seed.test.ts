import { describe, expect, it } from 'vitest';
import {
  VITE_CONFIG_FILENAMES,
  claimTemplateViteConfigSeed,
  findUserViteConfig,
  templateViteConfigSeedMarkerPath,
} from './vite-config-seed.ts';

describe('findUserViteConfig', () => {
  it('matches Vite DEFAULT_CONFIG_FILES order', () => {
    expect(VITE_CONFIG_FILENAMES).toEqual([
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.ts',
      'vite.config.cjs',
      'vite.config.mts',
      'vite.config.cts',
    ]);
  });

  it('reports js when js and ts coexist', () => {
    const present = new Set(['/scratch/vite.config.ts', '/scratch/vite.config.js']);
    expect(findUserViteConfig('/scratch', (path) => present.has(path))).toBe(
      '/scratch/vite.config.js',
    );
  });

  it('ignores non-root configs', () => {
    expect(
      findUserViteConfig('/scratch', (path) => path === '/scratch/src/vite.config.ts'),
    ).toBeNull();
  });
});

describe('claimTemplateViteConfigSeed', () => {
  const dec = new TextDecoder();
  const template = { id: 'vite', seedFiles: { '/scratch/vite.config.js': 'export default {};' } };
  const marker = templateViteConfigSeedMarkerPath('/scratch');

  function makeFs(initial: Readonly<Record<string, string>> = {}) {
    const files = new Map<string, string>(Object.entries(initial));
    return {
      files,
      existsSync: (path: string) => files.has(path),
      readFileBytesSync: (path: string) => new TextEncoder().encode(files.get(path) ?? ''),
      mkdirSync: () => {},
      writeFileSync: (path: string, data: Uint8Array) => files.set(path, dec.decode(data)),
    };
  }

  it('seeds a never-seeded root and records provenance', () => {
    const fs = makeFs();
    expect(claimTemplateViteConfigSeed('/scratch', fs, template)).toBe(true);
    expect(fs.files.get('/scratch/vite.config.js')).toBe('export default {};');
    expect(JSON.parse(fs.files.get(marker) ?? '')).toEqual({
      file: 'vite.config.js',
      template: 'vite',
    });
  });

  it('respects deletion after a seed marker', () => {
    const fs = makeFs({ [marker]: '{"file":"vite.config.js","template":"vite"}\n' });
    expect(claimTemplateViteConfigSeed('/scratch', fs, template)).toBe(false);
    expect(fs.files.has('/scratch/vite.config.js')).toBe(false);
  });

  it('never shadows a user config variant', () => {
    const fs = makeFs({ '/scratch/vite.config.ts': 'export default { plugins: [] };' });
    expect(claimTemplateViteConfigSeed('/scratch', fs, template)).toBe(false);
    expect(fs.files.has('/scratch/vite.config.js')).toBe(false);
    expect(fs.files.has(marker)).toBe(false);
  });

  it('claims no marker for a template without a config slot', () => {
    const fs = makeFs();
    expect(claimTemplateViteConfigSeed('/scratch', fs, { id: 'cli', seedFiles: {} })).toBe(false);
    expect(fs.files.has(marker)).toBe(false);
  });
});
