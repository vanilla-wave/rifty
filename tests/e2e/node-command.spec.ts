import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

// Escape a literal command for a RegExp that matches the terminal's `> <line>`
// echo (each typed line is echoed prefixed with `> `).
function echoRe(line: string): RegExp {
  return new RegExp(`> ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/**
 * Type a command line and CONFIRM it echoed before returning. A bare
 * `runTerminalLine` types right after the previous line's `echo > file` write,
 * whose snapshot republish re-renders the explorer; a keystroke landing in that
 * re-render is silently dropped (the line never reaches the shell — observed:
 * the `> <line>` echo never appears). This types once, waits for the echo, and
 * re-types ONLY if it is still absent after a settle window — bounded retries so
 * a one-shot server line (`listen(<port>)`) never double-runs into EADDRINUSE.
 * Deterministic (web-first echo wait, no fixed sleep on the success path); the
 * command's OWN effect is still asserted by the caller.
 */
async function runLineConfirmed(page: Page, line: string): Promise<void> {
  const re = echoRe(line);
  const echoed = async (): Promise<boolean> => re.test(await terminalBuffer(page));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await echoed()) return;
    await runTerminalLine(page, line);
    // Give the type a settle window to echo before deciding it was dropped.
    try {
      await expect.poll(echoed, { timeout: 6_000, intervals: [300, 600, 1_000] }).toBe(true);
      return;
    } catch {
      // Echo never landed — the keystroke was dropped in a re-render; retry.
    }
  }
  throw new Error(`command line never echoed after retries: ${line}`);
}

/**
 * `node <file>` terminal-command e2e (ADR-0155), chromium/COI only.
 *
 * The headline acceptance of ADR-0155: an arbitrary entry runs in a SUPERVISED
 * CHILD of the owner. `owner-shell-cowsay.spec.ts` proves a resolved `.bin`
 * launcher runs in a child; this proves the bare `node <file>` command does the
 * same for a user script AND brings a server's port into the preview registry:
 *
 *  1. RUN-TO-COMPLETION — a script that `console.log`s and `process.exit(0)`s
 *     streams its stdout over the pty channel and FREES the session (a prompt
 *     `echo` runs right after). A throwing script surfaces on stderr (the error
 *     message reaches the terminal). The shell exposes no `$?`, so the error
 *     case asserts the stderr text + that the session recovers, not an exit-code
 *     readback.
 *  2. SERVER + PREVIEW + Ctrl-C — a `node:http` server that `listen(3000)`s
 *     stays alive, posts its port to the owner preview registry, the SW routes
 *     `/preview/3000/` to the child, and the switcher gains a `:3000` option.
 *     Ctrl-C kills the child → the session frees AND the `:3000` entry leaves
 *     the switcher.
 *  3. MULTI-PORT SWITCHER — the co-resident dev server (vite, the default preset
 *     boot) + a `node` server on a distinct port populate the
 *     `.rf-preview__switcher` with multiple options that each point the iframe
 *     at the right `/preview/<port>/`.
 *
 * File seeding mirrors owner-shell-async-lifecycle.spec.ts: `echo '<src>' >
 * /scratch/<file>` writes the entry into the owner store the child reads over
 * fs.* sync-RPC. Server scripts use ESM `import http from "node:http"` — the
 * seeded workspace package.json is `type: module`, so a `.js` entry is ESM (a
 * `require()` would ReferenceError); @riftydev/net registers the `node:http`
 * builtin whose default export carries `createServer`.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; no PAGE shell
 * fallback) — the e2e harness serves COOP/COEP. Chromium-only, matching the
 * other COI specs.
 */
test.describe('terminal `node <file>` runs scripts + servers in a supervised child (ADR-0155)', () => {
  // SCENARIO 1 — run-to-completion + a throwing script.
  test('a script streams stdout, exits, and frees the session; a throw surfaces on stderr', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await bootProjectFiles(page);

    // Let the initial dev-server boot storm settle before interacting: clicks/
    // keystrokes during the mount storm land on replaced nodes (a typed line can
    // be lost). Wait for the boot signal first (mirror owner-shell-async-lifecycle).
    await expectViteDevServerReady(page, 5174, 90_000);

    // Terminal 2 = a plain idle shell on the persistent owner (Terminal 1 auto-
    // boots the dev server). Both sessions share the owner store.
    await openShellTerminal(page);

    // Run-to-completion script: log then exit 0.
    await runLineConfirmed(
      page,
      'echo \'console.log("hello from node"); process.exit(0);\' > /scratch/script.js',
    );
    await runLineConfirmed(page, 'node script.js');
    // The child's console.log reached the terminal over the pty stdout channel.
    await expectTerminalContains(page, 'hello from node', 20_000);

    // THE DECISIVE SIGNAL the session is NOT held: a follow-up command runs and
    // prints. A held session would swallow this keystroke into the child's stdin
    // (the terminal routes to the foreground process) and `done-1` never appears.
    await runLineConfirmed(page, 'echo done-1');
    await expectTerminalContains(page, 'done-1', 15_000);

    // A throwing script: the error message surfaces on stderr (a non-zero exit;
    // the shell has no `$?` to read back, so the error text + session recovery is
    // the load-bearing pair — a silent exit-0 or stub would never print kaboom).
    await runLineConfirmed(page, 'echo \'throw new Error("kaboom");\' > /scratch/boom.js');
    await runLineConfirmed(page, 'node boom.js');
    await expectTerminalContains(page, 'kaboom', 20_000);

    // Session recovered after the failed run too.
    await runLineConfirmed(page, 'echo done-2');
    await expectTerminalContains(page, 'done-2', 15_000);
  });

  // SCENARIO 2 — server: preview goes live, switcher gains the port, Ctrl-C frees it.
  test('a node:http server lights the preview at :3000 and Ctrl-C tears it down', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await bootProjectFiles(page);

    // SW must control the page before /preview/<port>/ can route (mirror fullstack-demo).
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Let the initial dev-server boot storm settle before interacting (a typed
    // line can be lost mid-mount-storm otherwise).
    await expectViteDevServerReady(page, 5174, 90_000);

    await openShellTerminal(page);

    // A node:http server that responds with a fixed marker and listens on :3000.
    // ESM import (the seeded workspace package.json is `type: module`, so a `.js`
    // entry is ESM — a `require()` here would ReferenceError, exit 1); the net
    // `node:http` builtin's default export carries `createServer`. Single-quoted
    // echo keeps the source verbatim; the inner string is double-quoted.
    await runLineConfirmed(
      page,
      'echo \'import http from "node:http"; http.createServer((_req, res) => res.end("NODE-SERVER-OK")).listen(3000);\' > /scratch/server.js',
    );
    await runLineConfirmed(page, 'node server.js');

    // The owner added a node preview slot → the page switcher renders a :3000
    // option (PreviewPanel switches to `<select class="rf-preview__switcher">`
    // once `ports()` is non-empty; the node label is `node :3000 (:3000)`).
    const switcher = page.locator('.rf-preview__switcher');
    await expect(switcher).toBeVisible({ timeout: 60_000 });
    await expect(switcher.locator('option', { hasText: ':3000' })).toHaveCount(1, {
      timeout: 30_000,
    });

    // The SW routes /preview/3000/ to the child realm → the server's body comes
    // back through the bridge (mirror fullstack-demo's subresource fetch). Poll:
    // the worker warms up behind the child spawn + first request.
    const fetchPreview = async (): Promise<{ ok: boolean; status: number; body: string }> =>
      page.evaluate(async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch('/preview/3000/', { cache: 'no-store', signal: ac.signal });
          return { ok: r.ok, status: r.status, body: await r.text() };
        } catch (err) {
          return { ok: false, status: 0, body: String((err as Error).message ?? err) };
        } finally {
          clearTimeout(timer);
        }
      });

    await expect
      .poll(async () => (await fetchPreview()).body, {
        timeout: 90_000,
        intervals: [1_000, 2_000, 4_000],
      })
      .toContain('NODE-SERVER-OK');

    // Ctrl-C kills the server child → its onExit drops the registry slot. Click
    // the terminal first so the keystroke targets the foreground session.
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');

    // The :3000 entry leaves the switcher (the only node port → the switcher
    // collapses back to the manual port input; assert the OPTION is gone, robust
    // to whether the dev-server slot is up yet in this terminal's view).
    await expect(switcher.locator('option', { hasText: ':3000' })).toHaveCount(0, {
      timeout: 30_000,
    });

    // The session recovered: a fresh command runs and prints — proving the child
    // was killed (else `echo freed` would land in the server child's stdin).
    await runLineConfirmed(page, 'echo freed');
    await expectTerminalContains(page, 'freed', 15_000);
  });

  // SCENARIO 3 — multi-port switcher over the dev server + a node server.
  test('the switcher lists the dev server + a node server and the iframe follows the selection', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await bootProjectFiles(page);

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // The default vite preset boots the co-resident dev server (Terminal 1) on
    // first load (its slot is `npm run dev`). Wait for its boot before adding
    // node servers so the registry already holds the dev slot.
    await expectViteDevServerReady(page);

    await openShellTerminal(page);

    // Two node servers on ports distinct from the vite dev port (5174). NOTE: this
    // test asserts TWO concurrent previewable ports in the switcher — the dev
    // server's slot + serverA's :4001 — to keep one COI test from juggling three
    // live child realms (each a worker behind fs.* RPC). The THIRD concurrent
    // port (serverB :4002) is covered by the registry unit test
    // (apps/playground/src/workers/preview-registry.test.ts), which proves the
    // dev slot + multiple node sids coexist in one snapshot. Coverage is NOT
    // silently reduced — the multi-node-sid case lives there, deterministically.
    await runLineConfirmed(
      page,
      'echo \'import http from "node:http"; http.createServer((_req, res) => res.end("SERVER-A-OK")).listen(4001);\' > /scratch/serverA.js',
    );
    await runLineConfirmed(page, 'node serverA.js');

    const switcher = page.locator('.rf-preview__switcher');
    await expect(switcher).toBeVisible({ timeout: 60_000 });

    // The switcher lists at least the dev server's port + the node :4001
    // server: two distinct previewable ports. The dev entry is labeled by its
    // REAL command (`vite :5174` — the bin that ran), not a synthesized
    // `npm run dev` slot (generic lifecycle: every server is a uniform entry).
    await expect(switcher.locator('option', { hasText: ':5174' })).toHaveCount(1, {
      timeout: 60_000,
    });
    await expect(switcher.locator('option', { hasText: ':4001' })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(switcher.locator('option')).toHaveCount(2, { timeout: 30_000 });

    // Selecting the :4001 option points the iframe at /preview/4001/. The panel
    // keys the iframe title + a warm-up fetch off the selected port; on a real
    // commit the title becomes `Preview port 4001`.
    await switcher.selectOption({ label: 'node :4001 (:4001)' });

    // The server is reachable through the SW route the iframe loads.
    const fetchA = async (): Promise<string> =>
      page.evaluate(async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch('/preview/4001/', { cache: 'no-store', signal: ac.signal });
          return await r.text();
        } catch (err) {
          return String((err as Error).message ?? err);
        } finally {
          clearTimeout(timer);
        }
      });
    await expect
      .poll(fetchA, { timeout: 90_000, intervals: [1_000, 2_000, 4_000] })
      .toContain('SERVER-A-OK');

    // The iframe followed the selection to the :4001 route.
    await expect(page.locator('iframe[title="Preview port 4001"]')).toBeVisible({
      timeout: 30_000,
    });
  });

  // SCENARIO 4 — node-only preview: stop the dev server, then `node server.js`
  // lights the preview on its own (ADR-0157 review C1). RED guard: under the old
  // `hasPreview = devServerStatus() !== 'stopped'` the panel/switcher would NEVER
  // re-appear once the dev server is stopped, even with a live node port.
  test('a node server lights the preview even when the dev server is stopped', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await bootProjectFiles(page);

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Dev server boots in Terminal 1 → preview is on.
    await expectViteDevServerReady(page, 5174, 90_000);
    const editorArea = page.locator('.rf-editorarea');
    await expect(editorArea).toHaveAttribute('data-preview', 'on', { timeout: 60_000 });

    // Ctrl-C the dev server (Terminal 1 foreground) → devServerStatus 'stopped'.
    // With no node ports yet, the preview panel hides (data-preview flips off).
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    await expect(editorArea).toHaveAttribute('data-preview', 'off', { timeout: 60_000 });

    // Now run a node:http server in the (freed) Terminal 1 — no dev server up.
    await runLineConfirmed(
      page,
      'echo \'import http from "node:http"; http.createServer((_req, res) => res.end("NODE-ONLY-OK")).listen(4003);\' > /scratch/only.js',
    );
    await runLineConfirmed(page, 'node only.js');

    // THE C1 SIGNAL: the preview comes back on a node-only port — the switcher
    // appears with :4003 and the editor area flips data-preview back on.
    const switcher = page.locator('.rf-preview__switcher');
    await expect(switcher).toBeVisible({ timeout: 60_000 });
    await expect(switcher.locator('option', { hasText: ':4003' })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(editorArea).toHaveAttribute('data-preview', 'on', { timeout: 30_000 });

    // The SW `/preview/<port>/` route — what the iframe loads and "open in new tab"
    // opens — resolves for a node-only port (dev stopped). (The previewUrl/openPreviewTab
    // un-gating itself is unit-pinned in App.test.ts; this asserts the live route.)
    const fetchOnly = async (): Promise<string> =>
      page.evaluate(async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch('/preview/4003/', { cache: 'no-store', signal: ac.signal });
          return await r.text();
        } catch (err) {
          return String((err as Error).message ?? err);
        } finally {
          clearTimeout(timer);
        }
      });
    await expect
      .poll(fetchOnly, { timeout: 90_000, intervals: [1_000, 2_000, 4_000] })
      .toContain('NODE-ONLY-OK');
  });
});
