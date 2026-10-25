/**
 * Opt-in live RUN of the playground's Express + SQLite template. The complete
 * runtime proof executes in a physical child, isolated from Vitest's IPC realm.
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run fullstack-demo-live-run.opt-in
 */
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { runRuntimeSmokeChild } from '../../packages/runtime-js/src/internal/runtime-smoke-child.test-helper.ts';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const fixture = fileURLToPath(new URL('./fixtures/fullstack-demo-smoke.ts', import.meta.url));
const marker = 'RIFTY_FULLSTACK_DEMO_SMOKE_OK';

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN the fullstack demo template', () => {
  it('serves the exact Express + SQLite template in an isolated runtime child', async () => {
    if (!liveRegistryUrl) throw new Error('unreachable — describe.skipIf gated');
    await runRuntimeSmokeChild({
      fixture,
      marker,
      timeoutMs: 180_000,
      env: { RIFTY_LIVE_REGISTRY: liveRegistryUrl },
    });
  }, 200_000);
});
