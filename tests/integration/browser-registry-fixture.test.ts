import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { browserRegistryPackages } from './browser-registry-fixture.mjs';

it('retains original npm fixtures for the complete committed Vite snapshot', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const packages = await browserRegistryPackages(root);
  expect(packages.get('vite')?.manifest.version).toBe('7.3.6');
  expect(packages.get('rollup')?.manifest.version).toBe(
    packages.get('@rollup/wasm-node')?.manifest.version,
  );
  expect(packages.get('esbuild-wasm')?.manifest.version).toBe('0.28.0');
});
