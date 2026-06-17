/**
 * Opt-in live "RUN real Vite" regression — Phase 2 (Vite-class).
 *
 * Real upstream Vite installs + loads through the rifty module loader +
 * `createServer` + `listen` + `transformRequest` succeed in-process (the M10
 * "Real Tooling" forcing consumer). Because the smoke replaces `globalThis.process`
 * with rifty's shim — incompatible with vitest's child-process IPC — it runs in a
 * SPAWNED `tsx` child (`tests/integration/fixtures/real-vite-smoke.ts`); this test
 * just drives it and asserts the success markers.
 *
 * **Skipped by default** — needs network + child spawn. Run manually with the
 * sandbox disabled:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run vite-live-run.opt-in
 *
 * Set `RIFTY_VITE_SPEC=^5.4.0` only when intentionally bisecting the old Vite
 * line; the default smoke uses `latest`.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const smoke = fileURLToPath(new URL('./fixtures/real-vite-smoke.ts', import.meta.url));

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN real vite', () => {
  it('installs + loads + serves: vite createServer/listen/transformRequest', async () => {
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn('npx', ['tsx', smoke], {
        env: { ...process.env, RIFTY_LIVE_REGISTRY: liveRegistryUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (c) => {
        out += String(c);
      });
      child.stderr.on('data', (c) => {
        out += String(c);
      });
      child.on('close', (code) => resolve({ code, out }));
    });

    if (code !== 0) {
      throw new Error(`real-vite-smoke exited ${code}:\n${out}`);
    }
    expect(out).toContain('VITE LOADED');
    expect(out).toContain('VITE LISTENING');
    expect(out).toMatch(/transformRequest\('\/src\/main\.js'\) -> \d+ bytes/);
    expect(out).toContain('RIFTY_VITE_SMOKE_OK');
  }, 280_000);
});
