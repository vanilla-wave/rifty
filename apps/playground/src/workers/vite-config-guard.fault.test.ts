/**
 * Fault: seeded vite-config provenance (fault: torn-state at the config-slot
 * seed boundary). The `.rifty/vite-config.seeded` marker means "seeded once;
 * later absence = user deleted it — never resurrect". A crash/quota failure
 * between the config write and the marker write must never leave a torn pair
 * the next boot trusts: marker-without-config starves the template config
 * forever; config-without-marker lets a later deletion resurrect it. Contract:
 * `claimTemplateViteConfigSeed` IS the transaction (config first, marker
 * second) and heals config-without-marker (exact seed bytes only).
 */
import { describe, expect, it } from 'vitest';
import {
  claimTemplateViteConfigSeed,
  templateViteConfigSeedMarkerPath,
} from './vite-config-guard.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ROOT = '/scratch';
const SEED = 'export default {};';
const CONFIG = '/scratch/vite.config.js';
const TEMPLATE = { id: 'vite', seedFiles: { [CONFIG]: SEED } };
const MARKER = templateViteConfigSeedMarkerPath(ROOT);

function makeFs(initial: Readonly<Record<string, string>> = {}, failOnce: readonly string[] = []) {
  const files = new Map<string, string>(Object.entries(initial));
  const pendingFailures = new Set(failOnce);
  return {
    files,
    existsSync: (p: string) => files.has(p),
    readFileBytesSync: (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT (test fs): ${p}`);
      return enc.encode(content);
    },
    mkdirSync: () => {},
    writeFileSync: (p: string, data: Uint8Array) => {
      if (pendingFailures.delete(p)) throw new Error(`quota exceeded (injected): ${p}`);
      files.set(p, dec.decode(data));
    },
  };
}

describe('claimTemplateViteConfigSeed (fault: torn-state config/marker pair)', () => {
  it('the claim itself lands the config: a caller crash right after the claim leaves no marker-without-config', () => {
    const fs = makeFs();
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(true);
    // Caller "crashes" here (writes nothing). The claim was the whole
    // transaction — both halves must already be durable together.
    expect(fs.files.get(CONFIG)).toBe(SEED);
    expect(fs.files.has(MARKER)).toBe(true);
  });

  it('marker-write failure mid-claim leaves config-without-marker (healable), never the reverse; next boot heals', () => {
    const fs = makeFs({}, [MARKER]);
    expect(() => claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toThrow(/quota/);
    expect(fs.files.get(CONFIG)).toBe(SEED); // config landed FIRST
    expect(fs.files.has(MARKER)).toBe(false);
    // Recovery boot: heal — marker recorded, config kept, no fresh-seed claim.
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(false);
    expect(fs.files.get(CONFIG)).toBe(SEED);
    expect(fs.files.has(MARKER)).toBe(true);
  });

  it('config-write failure mid-claim writes NO marker (marker never precedes config); retry seeds both', () => {
    const fs = makeFs({}, [CONFIG]);
    expect(() => claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toThrow(/quota/);
    // The old order persisted the marker before the config: this exact state
    // was then read forever as "user deleted the config".
    expect(fs.files.has(MARKER)).toBe(false);
    expect(fs.files.has(CONFIG)).toBe(false);
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(true);
    expect(fs.files.get(CONFIG)).toBe(SEED);
    expect(fs.files.has(MARKER)).toBe(true);
  });

  it('heal: config with exact template-seed bytes + marker absent -> marker recorded, config kept', () => {
    // Cohorts: crash between the new-order writes, the page preset-reset slot
    // write (seedOwner, marker-less), pre-marker-era roots.
    const fs = makeFs({ [CONFIG]: SEED });
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(false);
    expect(fs.files.get(CONFIG)).toBe(SEED);
    expect(JSON.parse(fs.files.get(MARKER) ?? '')).toEqual({
      file: 'vite.config.js',
      template: 'vite',
    });
  });

  it('deletion-respect unchanged: marker present + config absent -> never re-seed', () => {
    const fs = makeFs({ [MARKER]: '{"file":"vite.config.js","template":"vite"}\n' });
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(false);
    expect(fs.files.has(CONFIG)).toBe(false);
  });

  it('no-shadow unchanged: user bytes at the slot filename are never overwritten NOR marker-claimed by the heal', () => {
    const userConfig = 'export default { plugins: [] };';
    const fs = makeFs({ [CONFIG]: userConfig });
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(false);
    expect(fs.files.get(CONFIG)).toBe(userConfig);
    expect(fs.files.has(MARKER)).toBe(false);
  });

  it('no-shadow unchanged: a user vite.config.ts blocks the seed; nothing written', () => {
    const fs = makeFs({ '/scratch/vite.config.ts': 'export default {};' });
    expect(claimTemplateViteConfigSeed(ROOT, fs, TEMPLATE)).toBe(false);
    expect(fs.files.has(CONFIG)).toBe(false);
    expect(fs.files.has(MARKER)).toBe(false);
  });
});
