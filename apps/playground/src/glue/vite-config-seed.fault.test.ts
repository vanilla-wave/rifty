import { describe, expect, it } from 'vitest';
import {
  claimTemplateViteConfigSeed,
  templateViteConfigSeedMarkerPath,
} from './vite-config-seed.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const root = '/scratch';
const config = '/scratch/vite.config.js';
const seed = 'export default {};';
const template = { id: 'vite', seedFiles: { [config]: seed } };
const marker = templateViteConfigSeedMarkerPath(root);

function makeFs(initial: Readonly<Record<string, string>> = {}, failOnce: readonly string[] = []) {
  const files = new Map<string, string>(Object.entries(initial));
  const failures = new Set(failOnce);
  return {
    files,
    existsSync: (path: string) => files.has(path),
    readFileBytesSync: (path: string) => enc.encode(files.get(path) ?? ''),
    mkdirSync: () => {},
    writeFileSync: (path: string, data: Uint8Array) => {
      if (failures.delete(path)) throw new Error(`quota exceeded: ${path}`);
      files.set(path, dec.decode(data));
    },
  };
}

describe('claimTemplateViteConfigSeed torn writes', () => {
  it('marker failure leaves healable config-without-marker', () => {
    const fs = makeFs({}, [marker]);
    expect(() => claimTemplateViteConfigSeed(root, fs, template)).toThrow(/quota/);
    expect(fs.files.get(config)).toBe(seed);
    expect(fs.files.has(marker)).toBe(false);
    expect(claimTemplateViteConfigSeed(root, fs, template)).toBe(false);
    expect(fs.files.has(marker)).toBe(true);
  });

  it('config failure never writes marker and retry seeds both', () => {
    const fs = makeFs({}, [config]);
    expect(() => claimTemplateViteConfigSeed(root, fs, template)).toThrow(/quota/);
    expect(fs.files.has(marker)).toBe(false);
    expect(claimTemplateViteConfigSeed(root, fs, template)).toBe(true);
    expect(fs.files.get(config)).toBe(seed);
    expect(fs.files.has(marker)).toBe(true);
  });

  it('heals exact seed bytes but never marker-claims user bytes', () => {
    const heal = makeFs({ [config]: seed });
    expect(claimTemplateViteConfigSeed(root, heal, template)).toBe(false);
    expect(heal.files.has(marker)).toBe(true);

    const user = makeFs({ [config]: 'export default { plugins: [] };' });
    expect(claimTemplateViteConfigSeed(root, user, template)).toBe(false);
    expect(user.files.has(marker)).toBe(false);
  });
});
