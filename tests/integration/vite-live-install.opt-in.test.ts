/**
 * Opt-in live-registry Vite 8 install smoke.
 *
 * This Node-hosted lane proves acquisition plus install-time shadow materialisation.
 * Vite/Rolldown execution requires the real COI Worker topology and is covered by
 * `tests/browser-unit/esbuild-vite-contract.spec.ts`; a plain Node process cannot
 * honestly provide that runtime.
 *
 * Skipped by default — run manually with:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run vite-live-install.opt-in
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const smoke = fileURLToPath(new URL('./fixtures/real-vite-install-smoke.ts', import.meta.url));

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — install real Vite', () => {
  it('installs vite@8 and materialises its registry-backed shadow recipe', async () => {
    const { code, out } = await new Promise<{ code: number | null; out: string }>(
      (resolve, reject) => {
        const child = spawn('npx', ['tsx', smoke], {
          env: { ...process.env, RIFTY_LIVE_REGISTRY: liveRegistryUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          out += String(chunk);
        });
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({ code: exitCode, out }));
      },
    );

    expect(code, out).toBe(0);
    expect(out).toContain('RIFTY_VITE_INSTALL_OK');
  }, 280_000);
});
