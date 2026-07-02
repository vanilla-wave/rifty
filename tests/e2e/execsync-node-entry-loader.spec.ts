import { expect, test } from '@playwright/test';

/**
 * HONEST `execSync('node x.js')` node-entry-loader e2e (chromium/COI only,
 * ADR-0137 / ADR-0150).
 *
 * Proves the path Node tests CANNOT exercise: a real cross-origin-isolated owner
 * realm where `execSync`'s recursive child runs through the node-entry bootstrap
 * (`kind:'url'` + RIFTY_REMOTE_FS) + the module loader, reading the OWNER store
 * over `fs.*` sync-RPC. The in-process parity/unit tests cover the loader
 * behaviors in Node; only here does the real Worker + remote-fs path run.
 *
 * The guest runs `execSync('node /scripts/build.js')` where build.js:
 *   - starts with `#!/usr/bin/env node` — must be STRIPPED (not a SyntaxError,
 *     not echoed); the OLD raw `kind:'source'` (`new AsyncFunction`) threw here.
 *   - does `import './config.js'` (relative ESM) — must RESOLVE against the owner
 *     store; the old child read its OWN empty mirror (could not resolve).
 *   - does `fs.readFileSync('./pkg.json')` — must READ the owner store, not
 *     ENOENT against an empty realm mirror.
 * The load-bearing assertion is `loader === 'built:demo-pkg'`: `built` comes from
 * the relative-import `config.js` (`tag`), `demo-pkg` from the sibling
 * `pkg.json` read — both only succeed if shebang strip + relative resolve +
 * owner-store read all work end-to-end. A stub cannot fake it.
 *
 * Chromium-only: webkit/firefox SAB+SW is the historical flake source.
 */
test.describe('execSync `node x.js` routes through the node-entry loader (owner realm, ADR-0137)', () => {
  test('shebang stripped + relative import resolved + sibling fs.readFileSync over remote-fs', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'execSync over SAB needs a COI Worker — chromium only');
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Benign worker-stdout teardown race (mirror execsync-sab.spec.ts): after a
      // child exits, the kernel's stdout Readable pushes EOF and a late stdout
      // MessagePort chunk can `push()` after EOF — unrelated to execSync
      // correctness (the result is captured), so filter it.
      if (err.message.includes('stream.push() after EOF')) return;
      errors.push(err.message);
    });

    await page.goto('/#test=execsync');

    const harness = page.locator('[data-testid="execsync-harness"]');
    // Generous timeout: spawn guest + recursive node-entry child + SAB round-trip
    // + fs.* RPC reads. A hung dispatcher / ENOENT child would never paint pass.
    await expect(harness).toBeVisible({ timeout: 20_000 });

    const detail = (await page.locator('[data-testid="execsync-detail"]').textContent()) ?? '';
    const loader = (await page.locator('[data-testid="execsync-loader"]').textContent()) ?? '';

    // The decisive signal: the shebang'd, relative-importing, sibling-reading
    // build.js ran through the loader against the owner store and produced
    // `built:demo-pkg`. `built` ← relative `import './config.js'`; `demo-pkg` ←
    // `fs.readFileSync('./pkg.json')`. Pre-fix this was a SyntaxError / ENOENT.
    expect(loader, `harness detail: ${detail}`).toContain('built:demo-pkg');

    // Overall harness verdict (also gates the byte-exact + blocking round-trips).
    await expect(harness).toHaveAttribute('data-status', 'pass');

    expect(errors, `page errors: ${errors.join('; ')}`).toHaveLength(0);
  });
});
