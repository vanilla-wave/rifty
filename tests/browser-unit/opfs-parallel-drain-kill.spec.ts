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
 * the real flush seam) and is terminated on a DISCRIMINATED mid-drain ack;
 * worker 2 boots fresh over the torn OPFS, proves the boot path's own
 * check refuses the stamp, then re-runs the full sequence to a trusted
 * stamp, clean ledger, and a FULL-TREE byte-exact verify (all 600 files vs
 * the regenerated procedural spec — a spot check could bless a partial
 * tree). The worker drives the PRODUCTION claimIo composition —
 * `createOwnerVfsAuthorityComposition` → `installStampClaims` →
 * `createInstallStampAuthority` (workbench-owner-runtime.ts:244 /
 * owner-package-state.ts:230) — the reviewer-demanded sibling of the
 * raw-fsSync unit pins. See fixtures/opfs-parallel-drain-kill-worker.ts.
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-parallel-drain-kill-worker.ts?worker&url`;

interface MidDrainAck {
  readonly phase: 'mid-drain';
  readonly completed: number;
  readonly total: number;
}

interface RetryResult {
  readonly preTrusted: boolean;
  readonly preCheckStatus: string;
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
      // The ack itself is discriminated: it only arrives once SOME writes are
      // durably closed and MOST are still pending (0 < completed < total).
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
    `[pd256-kill] completed=${ack.completed}/${ack.total} preCheck=${retry.preCheckStatus} ` +
      `promote=${retry.promoteStatus} tree=${retry.treeFiles}/600`,
  );

  // Kill really landed mid-drain: past the first durable byte, far from done.
  expect(ack.phase).toBe('mid-drain');
  expect(ack.completed).toBeGreaterThan(0);
  expect(ack.completed).toBeLessThan(ack.total);
  // ADR-0358 reload honesty: the boot path's OWN reuse check (authority
  // check + installArtifactIdentity, owner-package-state.ts transition())
  // refuses the stamp over the torn tree…
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
