/**
 * Mid-drain kill e2e — TIER OBLIGATION of item
 * vfs/opfs-parallel-write-through-drain (issue #256, epic
 * project-open-drain-latency Decisions "Preserved constraint"). Pins
 * ADR-0358 "Reload honesty unchanged": a reload at ANY moment mid-drain
 * never trusts a stamp over an unproven tree.
 *
 * Status: GREEN on main (serial FIFO drain) and must SURVIVE the ~16-lane
 * parallel drain — a preservation carrier, not a RED target. It owns the
 * stamp-trust dimension the slice-1 kill carrier
 * (restore-mkdir-dedup.spec.ts row c) explicitly excluded: worker 1 runs
 * the REAL install sequence (demote → tree write → unawaited promote with
 * the real flush seam) and is terminated on a PATH-AWARE mid-drain ack;
 * worker 2 boots fresh over the torn OPFS, proves the surviving on-disk
 * stamp is EXACTLY the durable pending claim and the boot path's own
 * check refuses it, then re-runs the full sequence to a trusted stamp,
 * clean ledger, and a FULL-TREE byte-exact verify (all 600 files vs the
 * regenerated procedural spec — a spot check could bless a partial tree).
 *
 * The discriminator is PATH-AWARE because aggregate counting was a
 * FIFO-shaped assumption (attempt-4 reviewer finding): `0 < completed <
 * total` presumed the removed FIFO made the pending stamp + package.json
 * durable before any tree write, so under parallel lanes the realm could
 * die with an ABSENT stamp and `not.toBe('trusted')` would accept it —
 * dropping the strong half of reload honesty (a durable PENDING stamp is
 * never trusted). The ack now names the durable paths; phase 2 pins
 * `preStampDurability === 'pending'` exactly.
 *
 * The worker drives the PRODUCTION claimIo composition —
 * `createOwnerVfsAuthorityComposition` → `installStampClaims` →
 * `createInstallStampAuthority` (workbench-owner-runtime.ts:244 /
 * owner-package-state.ts:230) — the reviewer-demanded sibling of the
 * raw-fsSync unit pins; both stamp writers are swept. See
 * fixtures/opfs-parallel-drain-kill-worker.ts.
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-parallel-drain-kill-worker.ts?worker&url`;

interface MidDrainAck {
  readonly phase: 'mid-drain';
  readonly treeCompleted: number;
  readonly treeTotal: number;
  readonly stampDurable: boolean;
  readonly packageJsonDurable: boolean;
}

interface RetryResult {
  readonly preTrusted: boolean;
  readonly preCheckStatus: string;
  readonly preStampDurability: string;
  readonly promoteStatus: string;
  readonly postTrusted: boolean;
  readonly reportTotal: number;
  readonly treeVerified: boolean;
  readonly treeFiles: number;
  readonly treeFirstMismatch: string | null;
}

test('a realm KILLED mid-promote-drain never leaves a trusted stamp: the fresh realm refuses reuse, then a full re-run ends trusted (#256 fault row c)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  const ns = `/pd256-kill-${Date.now()}`;

  const { ack, retry } = await page.evaluate(
    async ({ moduleUrl, namespace }): Promise<{ ack: MidDrainAck; retry: RetryResult }> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const once = <T>(worker: Worker) =>
        new Promise<T>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                { readonly ok: true; readonly result: T } | { readonly ok: false; error: string }
              >,
            ) => {
              if (event.data.ok) resolve(event.data.result);
              else reject(new Error(event.data.error));
            },
            { once: true },
          );
          worker.addEventListener(
            'error',
            (event) => reject(new Error(event.message || 'drain-kill worker failed')),
            { once: true },
          );
        });

      const victim = new Worker(workerModule.default, { type: 'module' });
      const acked = once<MidDrainAck>(victim);
      victim.postMessage({ phase: 'kill-run', ns: namespace });
      // The ack itself is discriminated PATH-AWARE: it only arrives once the
      // PENDING stamp + package.json writes are durably closed and the tree
      // is strictly partial (0 < treeCompleted < treeTotal).
      const ack = await acked;
      victim.terminate();

      const fresh = new Worker(workerModule.default, { type: 'module' });
      try {
        const result = once<RetryResult>(fresh);
        fresh.postMessage({ phase: 'verify-retry', ns: namespace });
        return { ack, retry: await result };
      } finally {
        fresh.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, namespace: ns },
  );

  console.log(
    `[pd256-kill] tree=${ack.treeCompleted}/${ack.treeTotal} stampDurable=${ack.stampDurable} ` +
      `preStamp=${retry.preStampDurability} preCheck=${retry.preCheckStatus} ` +
      `promote=${retry.promoteStatus} verified=${retry.treeFiles}/600`,
  );

  // Kill really landed mid-drain, PATH-AWARE (attempt-4): the pending stamp
  // and package.json are durably closed and the node_modules tree is strictly
  // partial — an aggregate count would re-encode the removed FIFO's ordering
  // as a hidden assumption.
  expect(ack.phase).toBe('mid-drain');
  expect(ack.stampDurable).toBe(true);
  expect(ack.packageJsonDurable).toBe(true);
  expect(ack.treeTotal).toBe(600);
  expect(ack.treeCompleted).toBeGreaterThan(0);
  expect(ack.treeCompleted).toBeLessThan(600);
  // ADR-0358 reload honesty, strong half: the DURABLE pending claim survived
  // the kill — exactly 'pending' on disk; 'absent' no longer satisfies…
  expect(retry.preStampDurability).toBe('pending');
  // …and the boot path's OWN reuse check (authority check +
  // installArtifactIdentity, owner-package-state.ts transition()) refuses
  // that stamp over the torn tree…
  expect(retry.preTrusted).toBe(false);
  expect(retry.preCheckStatus).not.toBe('trusted');
  // …and only the full re-run concludes trusted, over a provably clean
  // ledger with reload-visible bytes.
  expect(retry.promoteStatus).toBe('trusted');
  expect(retry.postTrusted).toBe(true);
  expect(retry.reportTotal).toBe(0);
  // Full-tree proof through a fresh OpfsVfs: EXACTLY the 600-file spec —
  // every path, every size, every byte. First mismatch asserted first so a
  // failure names the offending path.
  expect(retry.treeFirstMismatch).toBeNull();
  expect(retry.treeVerified).toBe(true);
  expect(retry.treeFiles).toBe(600);
});
