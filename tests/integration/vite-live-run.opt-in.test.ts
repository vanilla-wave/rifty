/**
 * Opt-in live "RUN real Vite" regression — Phase 2 (Vite-class).
 *
 * Real upstream vite@8 installs in-process through the npm client and overlays
 * the shims. The load/createServer path requires Rolldown's WASI pthread worker
 * pool, so the standalone Node harness only runs that second half when SAB +
 * kernel-backed Worker URLs are present; otherwise it exits with an explicit
 * skip marker instead of hanging in the same-realm fallback.
 *
 * **Skipped by default** — needs network + child spawn. Run manually with the
 * sandbox disabled:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run vite-live-run.opt-in
 *
 * Set `RIFTY_VITE_SPEC` only when intentionally bisecting a different Vite
 * line; the default smoke uses `8.0.16`.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const smoke = fileURLToPath(new URL('./fixtures/real-vite-smoke.ts', import.meta.url));

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN real vite', () => {
  it('installs vite@8 and serves when kernel-backed workers are available', async (ctx) => {
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
    if (out.includes('RIFTY_VITE_SMOKE_REQUIRES_KERNEL_WORKERS')) {
      if (!out.includes('installed') || !out.includes('shims overlaid')) {
        throw new Error(`real-vite-smoke skipped before install/shims:\n${out}`);
      }
      ctx.skip();
      return;
    }

    expect(out).toContain('VITE LOADED');
    expect(out).toContain('ROLLDOWN PARSE OK');
    expect(out).toContain('VITE LISTENING');
    expect(out).toMatch(/transformRequest\('\/src\/main\.js'\) -> \d+ bytes/);
    expect(out).toContain('RIFTY_VITE_SMOKE_OK');
  }, 280_000);
});
