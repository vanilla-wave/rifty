/**
 * #255 owner-operation-silence-deadline, case 5 — in-tab recovery after the
 * owner-operation fatality. Real Workbench composition: real owner worker, real
 * OPFS (`persistence: 'required'`), real Web Locks, real page claim. No fake
 * anywhere on the path — a fake that only asserts timer bookkeeping cannot
 * close this acceptance.
 *
 * Fault classes: torn-state (a killed owner mid-operation leaves durable state
 * reconcilable from OPFS alone), provenance-lie (the failure names the silence
 * timeout, recovery never masks it).
 *
 * DESIGNED RED before the implementing commit: `ownerOperationSilenceTimeoutMs`
 * is not a Workbench option, so the tight-budget boot does NOT fail with a
 * silence timeout — it either succeeds or fails for an unrelated reason.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  attemptBootOwner,
  bootOwner,
  closeOwner,
  flushOwnerDurable,
  gotoHarness,
  readOwnerFile,
  writeOwnerFile,
} from './fixtures.ts';

const WORKBENCH_LOCK = 'rifty:workbench:v1';

function workbenchLockHolders(page: Page): Promise<readonly string[]> {
  return page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return (snapshot.held ?? []).flatMap((lock) => (lock.name === lockName ? [lock.name] : []));
  }, WORKBENCH_LOCK);
}

test('a silence-timeout fatality is recoverable in the same tab (#255)', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  const boot = {
    workspaceId: 'bu-silence-recovery',
    template: 'hidden-empty' as const,
    persistence: 'required' as const,
  };

  await bootOwner(page, boot);
  const marker = `silence-recovery ${Date.now().toString(36)}`;
  await writeOwnerFile(page, '/scratch/silence-probe.txt', marker);
  await flushOwnerDurable(page);
  await closeOwner(page);

  // 1 ms of tolerated progress silence: the first owner request wedges by
  // policy — pending op rejects, owner worker is killed, transport poisoned.
  const wedged = await attemptBootOwner(page, { ...boot, ownerOperationSilenceTimeoutMs: 1 });
  expect(wedged.ok).toBe(false);
  expect(
    wedged.messages.some((message) =>
      /timed out after 1ms without owner durability progress/.test(message),
    ),
  ).toBe(true);

  // In-tab recovery: no page reload; no residual Web Lock or page claim.
  await expect.poll(() => workbenchLockHolders(page), { timeout: 15_000 }).toEqual([]);
  await bootOwner(page, boot);
  expect(await workbenchLockHolders(page)).toEqual([WORKBENCH_LOCK]);
  expect(await readOwnerFile(page, '/scratch/silence-probe.txt')).toEqual({
    ok: true,
    text: marker,
    error: '',
  });
  await closeOwner(page);
});
