import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinShadowSubstitutionCatalog } from '../shadow-registry/src/internal/index.ts';

const recipe = builtinShadowSubstitutionCatalog.recipes.find(
  ({ trigger }) => trigger.name === 'lightningcss',
);
if (!recipe) throw new Error('Missing lightningcss recipe');
const matrixUrl = new URL('../../docs/public/compat/lightningcss.md', import.meta.url);

describe('lightningcss public compatibility contract', () => {
  it('publishes admission, acquisition, facade gaps and the measured init distinction', () => {
    const matrix = (() => {
      try {
        return readFileSync(matrixUrl, 'utf8');
      } catch {
        return '';
      }
    })();
    expect(matrix).toContain('lightningcss@1.32.0');
    expect(matrix).toContain('lightningcss-wasm@1.32.0');
    expect(matrix).toContain('semver-admits');
    expect(matrix).toContain('^1.30.0');
    expect(matrix).toContain(`NotImplementedError('${recipe.admission.unsupportedFeature}')`);
    expect(matrix).toContain("NotImplementedError('lightningcss.acquisition')");
    expect(matrix).toContain('| CJS / ESM facade | ⚠️ |');
    expect(matrix).toContain('| Default browser entry initialization | ⚠️ |');
    expect(matrix).toContain('TypeError');
    expect(matrix).toContain('wasm-node');
    expect(matrix).toContain('| CLI / bin | ❌ |');
    expect(matrix).toContain('| TypeScript declarations | ❌ |');
    expect(matrix).not.toContain("NotImplementedError('lightningcss.cli')");
    expect(matrix).not.toContain("NotImplementedError('lightningcss.types')");
    expect(matrix).toContain('`tools/checks/lightningcss-compat-matrix.test.ts`');
    expect(matrix).toContain('`packages/npm-client/src/installer-shadow-shims.test.ts`');
    const index = readFileSync(
      new URL('../../docs/public/compat/README.md', import.meta.url),
      'utf8',
    );
    expect(index).toContain('[lightningcss.md](./lightningcss.md)');
  });

  it('probes the real facade on Node and the uninitialized upstream browser entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-lightningcss-compat-'));
    try {
      const twin = join(root, 'node_modules/lightningcss-wasm');
      const facade = join(root, 'node_modules/lightningcss');
      mkdirSync(twin, { recursive: true });
      mkdirSync(facade, { recursive: true });
      execFileSync('tar', [
        '-xzf',
        fileURLToPath(
          new URL('../shadow-registry/src/fixtures/lightningcss-wasm-1.32.0.tgz', import.meta.url),
        ),
        '--strip-components=1',
        '-C',
        twin,
      ]);
      for (const file of recipe.materialization.files) {
        writeFileSync(join(facade, file.path), file.content);
      }
      expect(recipe.materialization.bin).toEqual({});
      const manifest = JSON.parse(readFileSync(join(facade, 'package.json'), 'utf8'));
      expect(manifest.types).toBeUndefined();
      expect(recipe.materialization.files.some(({ path }) => path.endsWith('.d.ts'))).toBe(false);
      const probe = join(root, 'probe.mjs');
      writeFileSync(
        probe,
        `
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import facade, { transform } from 'lightningcss';
import * as browser from './node_modules/lightningcss-wasm/index.mjs';
const require = createRequire(import.meta.url);
const input = { filename: 'input.css', code: Buffer.from('a { color: red; }'), minify: true };
let browserBefore;
try { browser.transform(input); } catch (error) { browserBefore = { name: error.name, message: error.message }; }
await browser.default(Promise.resolve(readFileSync(new URL('./node_modules/lightningcss-wasm/lightningcss_node.wasm', import.meta.url))));
console.log(JSON.stringify({
  node: process.version,
  cjs: require('lightningcss').transform(input).code.toString(),
  esm: transform(input).code.toString(),
  defaultType: typeof facade,
  browserBefore,
  browserAfter: browser.transform(input).code.toString(),
}));
`,
      );
      const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: 'utf8' }));
      expect(result).toMatchObject({
        cjs: 'a{color:red}',
        esm: 'a{color:red}',
        defaultType: 'object',
        browserBefore: {
          name: 'TypeError',
          message: "Cannot read properties of undefined (reading 'transform')",
        },
        browserAfter: 'a{color:red}',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
