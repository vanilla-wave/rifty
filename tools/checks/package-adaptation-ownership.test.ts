import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('registry ownership of existing package adaptations', () => {
  it('removes package implementations from the platform', () => {
    for (const file of [
      'vite-cli-prep.ts',
      'vite-cli-install-policy.ts',
      'vite-esbuild-runtime.ts',
      'vite-node-entry-edge.ts',
      'emnapi-core-install-policy.ts',
      'esbuild-runtime-fs.ts',
      'generated/esbuild-runtime.js',
    ]) {
      expect(existsSync(`packages/workbench/src/workers/${file}`), file).toBe(false);
    }
  });
  it('removes the package-specific runtime identity contract', () => {
    const source = readFileSync('packages/runtime-js/src/internal/worker-globals.ts', 'utf8');
    expect(source).not.toMatch(/esbuild/i);
    expect(readFileSync('packages/runtime-js/src/index.ts', 'utf8')).not.toMatch(/RuntimeEsbuild/);
  });
  it('keeps generic project provenance independent of package names', () => {
    for (const file of [
      'packages/workbench/src/glue/project-deps.ts',
      'packages/workbench/src/workers/dev-server-boot.ts',
    ]) {
      expect(readFileSync(file, 'utf8')).not.toContain('[real-vite/worker]');
    }
  });
});
