/**
 * M10 — real Vite HMR through the cross-realm bridge.
 *
 * Note: ADR-0161 disables HMR in the Vite 8 template until the Rolldown WASI
 * worker path has its own SAB/kernel-worker browser proof. This spec remains
 * the opt-in native-HMR harness shape, not evidence for Vite 8 support.
 *
 * What this verifies end-to-end (when enabled):
 *   1. The playground enters Real Vite mode.
 *   2. The preview iframe loads.
 *   3. An HMR-able edit to `src/main.js` propagates through Vite's real HMR
 *      WebSocket server over the generic `@riftydev/net` bridge and patches
 *      the module without a full iframe reload.
 *
 * Why this spec is skipped by default at agent-runtime time:
 *   - Real Vite mode bootstraps by installing Vite from the npm registry
 *     proxy. The install takes ~20s in the playground's local dev env even
 *     on a warm machine, and is wire-bound when the proxy is cold. Running
 *     it as part of every CI invocation would dwarf the rest of the M0..M9
 *     suite. The integration test in
 *     `tests/integration/vite-hmr-channel.test.ts` already exercises Vite's
 *     native `server.ws` against rifty `http.Server.on('upgrade')`.
 *   - Set `RIFTY_E2E_HMR=1` to opt-in locally once you've warmed the
 *     install cache and want to validate the full roundtrip against a real
 *     browser. The first run still pays the install cost; subsequent runs
 *     reuse the tarball cache (ADR-0023).
 *
 * Manual verification steps (no env flag needed):
 *   1. `pnpm dev` → open `http://localhost:5273`.
 *   2. Pick the Project files starter and wait for the LIVE :5174 pill.
 *   3. Confirm the preview iframe shows the seeded "Hello from real Vite"
 *      message.
 *   4. Open DevTools → `Application` → `Frames` → drill into the preview
 *      iframe; in its Console run
 *         document.querySelector('script[data-rifty-ws-bridge]') !== null
 *      and confirm it is `true`. That proves the generic preview-path
 *      injection (ADR-0189) installed the inline WebSocket bridge.
 *   5. Edit the editor pane to change the body text. Save (Cmd/Ctrl-S in
 *      the editor or wait the implicit auto-update).
 *   6. The iframe should update within the file-watcher poll interval without
 *      losing `globalThis` state; the terminal logs no errors.
 */
import { type Locator, expect, test } from '@playwright/test';
import { bootProjectFiles, expectViteDevServerReady } from './helpers/playground.ts';

const enabled = process.env.RIFTY_E2E_HMR === '1';
const HMR_EVENT_KEY = '__rifty_e2e_hmr';

test.describe('M10 — real Vite HMR over cross-realm bridge', () => {
  test.skip(!enabled, 'set RIFTY_E2E_HMR=1 to run; bootstraps a real Vite install (~20s)');

  test('preview iframe patches src/main.js without a full reload', async ({ page }) => {
    test.setTimeout(120_000);
    // Project-first: pick the real-vite starter to boot the dev server (main used to
    // auto-boot it on load; the chooser now gates that behind an explicit pick).
    await bootProjectFiles(page);
    await expectViteDevServerReady(page, 5174, 90_000);

    // The preview iframe must mount and load the bridge client (ADR-0189
    // generic preview-path injection). Key the frame by its stable title —
    // `.first()` breaks if another iframe ever precedes it in DOM order.
    const previewFrame = page.frameLocator('iframe[title="Preview port 5174"]');
    const previewBody = previewFrame.locator('body');
    await expect(previewFrame.locator('script[data-rifty-ws-bridge]')).toHaveCount(1, {
      timeout: 30_000,
    });
    await previewBody.evaluate((_, key) => {
      const marker = `survive-${Date.now()}`;
      (globalThis as typeof globalThis & { __riftyHmrSentinel?: string }).__riftyHmrSentinel =
        marker;
      localStorage.setItem(`${key}:sentinel`, marker);
      localStorage.removeItem(`${key}:beforeunload`);
      localStorage.setItem(`${key}:messages`, '[]');
      globalThis.addEventListener('beforeunload', () => {
        localStorage.setItem(`${key}:beforeunload`, '1');
      });
      globalThis.addEventListener('rifty:ws:message', (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        const messagesKey = `${key}:messages`;
        const messages = JSON.parse(localStorage.getItem(messagesKey) ?? '[]') as unknown[];
        messages.push(detail);
        localStorage.setItem(messagesKey, JSON.stringify(messages));
        localStorage.setItem(key, JSON.stringify(detail));
      });
    }, HMR_EVENT_KEY);
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as unknown as { __riftyWsBridgeOpen?: unknown };
            return global.__riftyWsBridgeOpen === true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Snapshot the current body text so we can assert a real change.
    const initialBody = await previewFrame.locator('#app').textContent();
    expect(initialBody).toBeTruthy();

    // Edit the file through Monaco's real input path; no test-only setter.
    // Prepend a stable override instead of relying on platform-specific
    // select-all shortcuts to replace the whole model.
    const marker = `hmr-${Date.now()}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(
      `setInterval(() => { document.getElementById('app').textContent = ${JSON.stringify(
        marker,
      )}; }, 50);\n`,
    );
    await expect(editorLines).toContainText(marker);
    await expect(previewFrame.locator('#app')).toHaveText(marker, { timeout: 30_000 });
    await waitForNativeUpdatePayload(previewBody, HMR_EVENT_KEY, marker);
    const hmrPayload = await readNativeUpdatePayload(previewBody, HMR_EVENT_KEY);
    expect(hmrPayload).toMatchObject({
      type: 'update',
      updates: [expect.objectContaining({ path: '/src/main.js', acceptedPath: '/src/main.js' })],
    });
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as typeof globalThis & { __riftyHmrSentinel?: string };
            return global.__riftyHmrSentinel;
          }),
        { timeout: 10_000 },
      )
      .toBe(
        await previewBody.evaluate(
          (_, key) => localStorage.getItem(`${key}:sentinel`),
          HMR_EVENT_KEY,
        ),
      );
    await expect
      .poll(() =>
        previewBody.evaluate(
          (_, key) => localStorage.getItem(`${key}:beforeunload`),
          HMR_EVENT_KEY,
        ),
      )
      .toBeNull();
  });
});

interface HmrPayload {
  readonly type?: unknown;
  readonly updates?: readonly { readonly path?: unknown; readonly acceptedPath?: unknown }[];
}

async function readHmrMessages(previewBody: Locator, key: string): Promise<HmrPayload[]> {
  const raw = await previewBody.evaluate(
    (_, storageKey) => localStorage.getItem(`${storageKey}:messages`) ?? '[]',
    key,
  );
  return JSON.parse(raw) as HmrPayload[];
}

function isMainJsNativeUpdate(payload: HmrPayload): boolean {
  return (
    payload.type === 'update' &&
    Array.isArray(payload.updates) &&
    payload.updates.some(
      (update) => update.path === '/src/main.js' && update.acceptedPath === '/src/main.js',
    )
  );
}

async function hasNativeUpdatePayload(previewBody: Locator, key: string): Promise<boolean> {
  return (await readHmrMessages(previewBody, key)).some(isMainJsNativeUpdate);
}

async function waitForNativeUpdatePayload(
  previewBody: Locator,
  key: string,
  marker: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let state = '';
  while (Date.now() < deadline) {
    if (await hasNativeUpdatePayload(previewBody, key)) return;
    state = await describeHmrProbeState(previewBody, key, marker);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`native Vite update payload not found after DOM patch: ${state}`);
}

async function readNativeUpdatePayload(previewBody: Locator, key: string): Promise<HmrPayload> {
  const found = (await readHmrMessages(previewBody, key)).find(isMainJsNativeUpdate);
  if (!found) throw new Error('native Vite update payload not found');
  return found;
}

async function describeHmrProbeState(
  previewBody: Locator,
  key: string,
  marker: string,
): Promise<string> {
  return previewBody.evaluate(
    (body, args) => {
      const global = globalThis as typeof globalThis & {
        __riftyWsBridgeOpen?: unknown;
        __riftyHmrSentinel?: string;
        __riftyWsBridgeLastMessage?: unknown;
      };
      return JSON.stringify({
        beforeunload: localStorage.getItem(`${args.key}:beforeunload`),
        messages: JSON.parse(localStorage.getItem(`${args.key}:messages`) ?? '[]'),
        lastMessage: global.__riftyWsBridgeLastMessage,
        open: global.__riftyWsBridgeOpen,
        sentinel: global.__riftyHmrSentinel,
        storedSentinel: localStorage.getItem(`${args.key}:sentinel`),
        bodyText: body.textContent,
        marker: args.marker,
      });
    },
    { key, marker },
  );
}
