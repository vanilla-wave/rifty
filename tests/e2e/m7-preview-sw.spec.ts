/**
 * M7 — HTTP request rounds through the Service Worker preview path.
 *
 * Covers the M7 acceptance criterion (PROJECT_PLAN.md §M7, line ~315):
 *
 *   > Express "hello world" → видим страницу в браузере.
 *
 * What this proves end-to-end (everything the integration smoke
 * `tests/integration/express-style.test.ts` deliberately bypasses):
 *
 *   1. The playground main thread brings up an `http.createServer().listen(N)`
 *      using `@riftydev/net` — exactly the path a user program follows. We use
 *      the existing `@rifty-examples/vite-like-dev` fixture (started by
 *      clicking the playground's "Dev Mode" button) because it is the only
 *      runnable HTTP-server-from-user-code program currently wired into the
 *      playground's `node:http` builtin, and the task spec explicitly accepts
 *      it as "still proof of the SW round-trip; Express specifics aren't what
 *      the SW path cares about".
 *   2. `mountPlaygroundPreviewBridge()` installs the main-thread
 *      `setupPreviewBridge` handler that translates a `SerializedRequest`
 *      from the SW into a `dispatchToPort` call against the `@riftydev/net`
 *      port registry, then returns the streaming `Response` as a
 *      `SerializedResponse` via `packSerializedResponse`.
 *   3. The Service Worker's `installPreviewInterceptor(self)` matches
 *      `/preview/<port>/*`, posts the request to the resolved client over a
 *      fresh `MessageChannel`, awaits the reply, and synthesises an HTTP
 *      `Response` for the caller — including the COEP `credentialless` +
 *      `Cross-Origin-Resource-Policy` defaults from `route-preview.ts`.
 *   4. The full body, status, and `content-type` cross-realm-serialise back
 *      to the original `fetch()` caller via `packSerializedResponse`'s
 *      transferable `ReadableStream` (ADR-0017 phase 1).
 *
 * Why this gap mattered: `tests/integration/express-style.test.ts` invokes
 * `dispatchToPort(port, request)` directly. That is a single-realm call into
 * the port registry — it never touches `setupPreviewBridge`, the SW
 * interceptor, the `MessageChannel` plumbing, or `packSerializedResponse`.
 * Before this spec, the M7 acceptance line above was not test-covered. The
 * 2026-05-26 architecture audit flagged this as a P0 gap.
 *
 * SW-active wait pattern: we use a `page.waitForFunction` that asserts
 * `navigator.serviceWorker.controller` is non-null — meaning the SW is not
 * only registered but is actually controlling the current page. This is
 * stronger than `getRegistration().active` (which only confirms the SW exists)
 * and avoids the race where the bridge handler posts `rifty:preview:ready` to
 * a missing `controller` and the SW never receives the handshake.
 */
import { expect, test } from '@playwright/test';

test.describe('M7 — HTTP through the Service Worker preview bridge', () => {
  test('GET /preview/3000/ returns user-served HTML round-tripped through the SW', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');

    // The runtime worker boot signal is the cleanest proof the playground's
    // bootstrap pipeline (COI guard → VFS init → SW register → worker spawn)
    // settled. Same gate the other milestone specs use.
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });

    // Wait for the SW to actually CONTROL this page (not just be registered).
    // Until `controller` is non-null, `setupPreviewBridge` cannot post the
    // `rifty:preview:ready` handshake — the bridge would mount but never
    // confirm itself, and the SW would 503 every preview fetch.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Click "Dev Mode" — runs `startDevMode({port: 3000})`, which (1) brings
    // up an `http.createServer().listen(3000)` from `@riftydev/net` and (2)
    // mounts `setupPreviewBridge` via `mountPlaygroundPreviewBridge()`. This
    // is the "user program registers an HTTP server" step.
    await page.locator('[data-action="dev-mode"]').click();
    await expect(page.locator('[data-action="dev-mode"]')).toContainText('Dev Mode', {
      timeout: 10_000,
    });

    // Probe the SW → bridge → port-registry round-trip from the playground
    // page itself. The fetch goes against same-origin `/preview/3000/`, which
    // the SW interceptor (`route-preview.ts`) recognises and forwards to the
    // controlled window client. That client is *this* page — the one with
    // the bridge handler — so the request reaches the registered port
    // handler (vite-like-dev's static serve from VFS) and we can inspect the
    // full Response without iframe sandboxing.
    const probe = await page.evaluate(async () => {
      const r = await fetch('/preview/3000/');
      return {
        status: r.status,
        contentType: r.headers.get('content-type'),
        body: await r.text(),
      };
    });

    // The vite-like-dev fixture serves `index.html` for `/` (with the
    // injected `rifty:hmr` client script appended). Asserting on the seeded
    // `<h1>` text proves the SW round-trip reached the registered handler
    // and returned the bytes it read from the VFS.
    expect(probe.status).toBe(200);
    expect(probe.contentType).toContain('text/html');
    expect(probe.body).toContain('Hello from rifty');
    // The HMR client is appended by the dev server before `</body>` — its
    // presence proves the response *body* (not just status/headers) round-
    // tripped through the bridge's `packSerializedResponse` carrier.
    expect(probe.body).toContain('rifty:hmr client');
  });
});
