/**
 * #255 owner-operation-silence-deadline, case 5 — in-tab recovery after the
 * owner-operation fatality. Real Workbench composition: real owner worker, real
 * OPFS (`persistence: 'required'`), real Web Locks, real page claim. No fake
 * anywhere on the path — a fake that only asserts timer bookkeeping cannot
 * close this acceptance.
 *
 * Fault injection is at the page↔owner boundary and deterministic, never a
 * scheduling race: one admitted owner request is DELAYED (never dropped,
 * duplicated, or reordered — `fault-classes.md` §Boundary failure models,
 * MessagePort/dedicated Worker row admits exactly "slow peer") far past the
 * configured budget, so the owner provably cannot answer or emit any
 * durability progress inside it.
 *
 * Fault classes: torn-state (a killed owner mid-operation leaves durable state
 * reconcilable from OPFS alone), provenance-lie (the failure names the silence
 * timeout, recovery never masks it).
 *
 * DESIGNED RED before the implementing commit: `ownerOperationSilenceTimeoutMs`
 * is not a Workbench option, so the stalled request rides the fixed 60 s
 * duration deadline and this test's budget-scoped assertions fail.
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
const SILENCE_BUDGET_MS = 3_000;
/** 10x the budget: delivery is late, never lost — the owner cannot pre-answer. */
const STALL_MS = 30_000;

interface StallScope {
  readonly held: number;
  restore(): void;
}

type ScopedGlobal = typeof globalThis & { __ownerRequestStall?: StallScope };

/** Delays the first admitted owner request frame; every other frame is untouched. */
async function stallNextOwnerRequest(page: Page, holdMs: number): Promise<void> {
  await page.evaluate((hold) => {
    type PortPostMessage = (this: MessagePort, message: unknown, transfer?: unknown) => void;
    const proto = MessagePort.prototype as unknown as { postMessage: PortPostMessage };
    const native = proto.postMessage;
    let held = 0;

    const carriesOwnerRequest = (value: unknown, depth: number): boolean => {
      if (depth > 3 || typeof value !== 'object' || value === null) return false;
      const frame = value as Record<string, unknown>;
      if (typeof frame.opId === 'string' && typeof frame.type === 'string') {
        if (frame.type.startsWith('workbench:')) return true;
      }
      for (const nested of Object.values(frame)) {
        if (carriesOwnerRequest(nested, depth + 1)) return true;
      }
      return false;
    };

    proto.postMessage = function stalled(
      this: MessagePort,
      message: unknown,
      transfer?: unknown,
    ): void {
      if (held === 0 && carriesOwnerRequest(message, 0)) {
        held += 1;
        setTimeout(() => native.call(this, message, transfer), hold);
        return;
      }
      native.call(this, message, transfer);
    };

    const scope = globalThis as ScopedGlobal;
    scope.__ownerRequestStall = {
      get held() {
        return held;
      },
      restore() {
        proto.postMessage = native;
      },
    };
  }, holdMs);
}

function heldOwnerRequests(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as ScopedGlobal).__ownerRequestStall?.held ?? -1);
}

async function restoreOwnerRequests(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as ScopedGlobal).__ownerRequestStall?.restore();
  });
}

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

  // Slow peer: the next admitted owner request lands 30 s late, so the page
  // observes 30 s of progress silence against a 3 s budget.
  await stallNextOwnerRequest(page, STALL_MS);
  const startedAt = Date.now();
  const wedged = await attemptBootOwner(page, {
    ...boot,
    ownerOperationSilenceTimeoutMs: SILENCE_BUDGET_MS,
  });
  const elapsedMs = Date.now() - startedAt;
  await restoreOwnerRequests(page);

  expect(await heldOwnerRequests(page)).toBe(1);
  expect(wedged.ok).toBe(false);
  expect(
    wedged.messages.some((message) =>
      /timed out after 3000ms without owner durability progress/.test(message),
    ),
  ).toBe(true);
  // The budget, not the stall, decides: failing at 30 s would mean the deadline
  // waited for the delayed frame instead of bounding the silence.
  expect(elapsedMs).toBeLessThan(STALL_MS);

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
