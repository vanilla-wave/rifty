/**
 * Opt-in live registry test — covers the `npm install express@^4` end-to-end
 * scenario the 2026-05-26 audit flagged as the M9 closure gate.
 *
 * **Skipped by default** — CI must not depend on network or on the live
 * Vercel Edge proxy (ADR-0028). Run manually:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run express-live.opt-in
 *
 * Or against the prod proxy URL once the playground is deployed:
 *
 *     RIFTY_LIVE_REGISTRY=https://<host>/npm-registry pnpm vitest run express-live.opt-in
 *
 * What the test verifies:
 *   - The flat-only linker survives Express's 50+ transitive deps.
 *   - If it fails with `EVERSIONCONFLICT`, the offending pair is in the
 *     thrown error's `packageName` / `firstVersion` / `secondVersion`
 *     fields — capture them and file as M11 nested-install priority.
 *   - On success: the test logs the resolved set size and the lockfile
 *     path; the operator confirms the install actually wrote to vfs.
 *
 * Why this matters: per the follow-ups doc (item #1), flat-only linker
 * throws `EVERSIONCONFLICT` on any version overlap. If Express's transitive
 * graph hits one, M11 nested install becomes a prerequisite for M9 closure
 * (instead of a follow-on).
 */
import { type InstallResult, RegistryClient, install } from '@rifty/npm-client';
import { MemoryVfs } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — live express install', () => {
  it('installs express@^4 against the live registry', async () => {
    if (!liveRegistryUrl) throw new Error('unreachable — describe.skipIf gated');

    const vfs = new MemoryVfs();
    const registry = new RegistryClient({ baseUrl: liveRegistryUrl, fetch: globalThis.fetch });

    let result: InstallResult;
    try {
      result = await install(
        'rifty-express-smoke',
        '0.0.0',
        { express: '^4' },
        { vfs, cwd: '/app', registry },
      );
    } catch (err) {
      const e = err as Error & {
        code?: string;
        packageName?: string;
        firstVersion?: string;
        secondVersion?: string;
      };
      console.log(`[express-live] install threw: code=${e.code ?? ''} msg=${e.message}`);
      if (e.code === 'EVERSIONCONFLICT') {
        console.log(
          `[express-live] conflict on ${e.packageName ?? '?'}: ${
            e.firstVersion ?? '?'
          } vs ${e.secondVersion ?? '?'}`,
        );
        console.log('[express-live] → M11 nested install must land before M9 closes');
      }
      throw err;
    }

    expect(result.packages.length).toBeGreaterThan(20);
    expect(await vfs.exists('/app/node_modules/express/package.json')).toBe(true);
    expect(await vfs.exists('/app/package-lock.json')).toBe(true);

    const names = result.packages.map((p) => p.name).sort();
    console.log(`[express-live] resolved ${result.packages.length} packages:`);
    console.log(`[express-live]   ${names.join(', ')}`);
  }, 60_000); // generous timeout for live network
});
