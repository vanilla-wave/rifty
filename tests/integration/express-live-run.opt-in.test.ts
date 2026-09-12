/**
 * Opt-in live "RUN real express" smoke. The runtime-global work executes in a
 * physical child so rifty's process/Buffer/timer globals never replace Vitest's.
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run express-live-run.opt-in
 */
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { runRuntimeSmokeChild } from '../../packages/runtime-js/src/internal/runtime-smoke-child.test-helper.ts';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const fixture = fileURLToPath(new URL('./fixtures/express-live-smoke.ts', import.meta.url));
const marker = 'RIFTY_EXPRESS_LIVE_SMOKE_OK';

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN real express', () => {
  it('installs and serves real Express requests in an isolated runtime child', async () => {
    if (!liveRegistryUrl) throw new Error('unreachable — describe.skipIf gated');
    await runRuntimeSmokeChild({
      fixture,
      marker,
      timeoutMs: 180_000,
      env: { RIFTY_LIVE_REGISTRY: liveRegistryUrl },
    });
  }, 200_000);
});
