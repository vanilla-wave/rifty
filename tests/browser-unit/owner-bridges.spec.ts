import { expect, test } from '@playwright/test';

/**
 * Owner→page bridge contracts, behaviorally, against the REAL owner worker
 * (browser-unit lane, ADR-0196) — the tier the worker-file source-greps lacked:
 *   1. vfs-write ack round-trip: writeFrameAcked persists into the OWNER tree
 *      (readFileBytes returns the bytes back).
 *   2. vfs-write ack error contract: a failing frame rejects with the owner's
 *      REAL error name/message (never a silent ok).
 *   3. pty:preview republish handshake: a subscribe + request always yields a
 *      frame (never a missed one-shot push).
 */

test.describe('workspace-owner bridges (real worker, no App)', () => {
  test('vfs-write ack + readFileBytes round-trip, error contract, preview handshake', async ({
    page,
  }) => {
    await page.goto('/unit-harness.html');
    await page.waitForSelector('#browser-unit-harness[data-status="ready"]');

    const result = await page.evaluate(async () => {
      const [realVite, hiddenEmpty] = await Promise.all([
        import('/src/glue/realVite.ts'),
        import('/src/templates/hidden-empty.ts'),
      ]);
      const logs: string[] = [];
      const handle = realVite.startWorkspaceOwner({
        workspaceId: 'browser-unit-bridges',
        root: '/scratch',
        template: hiddenEmpty.HIDDEN_EMPTY_TEMPLATE,
        slug: 'scratch',
        setup: 'instant',
        hiddenEmptyBoot: true,
        onLog: (line: string) => logs.push(line),
      });
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`owner ready timed out; logs:\n${logs.slice(-40).join('')}`)),
          60_000,
        );
      });
      await Promise.race([handle.ready, timeout]);

      // 1. write → acked → read back through the owner byte reader.
      const content = `bridge-roundtrip ${'x'.repeat(64)}`;
      await handle.writeFrameAcked({
        type: 'write',
        path: '/scratch/bridge-roundtrip.txt',
        data: new TextEncoder().encode(content),
      });
      const bytes = await handle.readFileBytes('/scratch/bridge-roundtrip.txt');
      const readBack = new TextDecoder().decode(bytes);

      // 2. a failing frame surfaces the owner's REAL error (ack ok:false path).
      let ackError: { name: string; message: string } | null = null;
      try {
        await handle.writeFrameAcked({
          type: 'rename',
          from: '/scratch/definitely-missing-source.txt',
          to: '/scratch/whatever.txt',
        });
      } catch (err) {
        ackError =
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { name: 'unknown', message: String(err) };
      }

      // 3. preview republish handshake: subscribe + request ⇒ a frame arrives
      //    even when the set is empty (missed-before-listener discipline).
      const previewFrame = await new Promise<{ ports: unknown[] } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 10_000);
        const unsub = handle.onPreview((frame: { ports: unknown[] }) => {
          clearTimeout(timer);
          unsub();
          resolve(frame);
        });
        handle.requestPreview();
      });

      handle.close();
      return { readBack, ackError, previewFrame, content };
    });

    expect(result.readBack).toBe(result.content);
    expect(result.ackError).not.toBeNull();
    expect(result.ackError?.message).toBeTruthy();
    expect(result.ackError?.message).toContain('definitely-missing-source');
    expect(result.previewFrame).not.toBeNull();
    expect(Array.isArray(result.previewFrame?.ports)).toBe(true);
  });
});
