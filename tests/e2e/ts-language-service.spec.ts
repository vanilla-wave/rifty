import { type Page, expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine, terminalBuffer } from './helpers/playground.ts';

// Run this file's tests SERIALLY (override the config's fullyParallel): each test
// cold-boots its OWN workspace owner + LS grandchild and fetches the ~3 MB
// vendored lib.d.ts. Two such cold-boots in parallel starve CPU/memory and the
// (already generous) per-poll budgets time out — a contention artefact, not a
// product bug. Serial keeps each cold-boot isolated on one worker.
test.describe.configure({ mode: 'serial' });

/**
 * The rifty worker-resident TS language service surfaces REAL semantic
 * diagnostics in the playground (ADR-0166 P1.9) — squiggles in Monaco + rows in
 * the Problems tab — driven through the full page→owner→LS→owner→page relay.
 *
 * Architecture proven by this spec (single-store-owner, ADR-0148): the LS runs in
 * a serve:true grandchild the OWNER spawns, reading the owner's authoritative VFS
 * over fs.* sync-RPC. The page has no direct channel to it, so every `rifty:ts-lsp`
 * frame relays through the owner. A page-spawned LS would see an EMPTY tree; if the
 * relay/spawn were wrong, NO diagnostic would ever arrive and these polls fail.
 *
 * Load-bearing: the diagnostic is a genuine TS type error (TS2322,
 * number = string). It only appears if (a) the owner spawned the LS child, (b) the
 * page→owner→LS request reached it, (c) the LS built a real ts.LanguageService
 * over the owner VFS (vendored lib.d.ts), (d) the LS→owner→page response carried
 * the diagnostic back, (e) the page mapped it to a Monaco marker + a Problems row.
 * Then FIXING the type clears BOTH — proving the live update path (ts:update →
 * fresh diagnostics), not a one-shot static render.
 *
 * Input fidelity: the type error is typed through the REAL Monaco input
 * (`page.keyboard.insertText` into `textarea.inputarea`) — a genuine keystroke →
 * `onDidChangeModelContent` → debounced `ts:update`. The deterministic FULL
 * REPLACE for the fix goes through `__riftySetEditorValue`, an EditorHost test
 * hook that calls `model.setValue` — the SAME `onDidChangeModelContent` the
 * keyboard fires (Monaco's Cmd/Ctrl-A select-all is unreliable under Playwright,
 * so a keyboard full-replace is flaky). The LS pipeline under assertion is 100%
 * real either way; only the text delivery for the fix is made deterministic.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; no page fallback) —
 * the e2e harness serves COOP/COEP. Chromium-only, matching the other owner specs.
 */

const TS_PATH = '/workspace/src/lsp-check.ts';

/** rifty-TS marker count for a VFS path via the EditorHost e2e hook (ADR-0166 P1.9d). */
async function tsMarkerCount(page: Page, path: string): Promise<number> {
  return page.evaluate((p) => {
    const fn = (globalThis as { __riftyTsMarkers?: (path: string) => number }).__riftyTsMarkers;
    return fn ? fn(p) : -2; // -2: hook not installed (editor not mounted yet)
  }, path);
}

/** Set an open model's whole content via the EditorHost test hook (real change event). */
async function setModelValue(page: Page, path: string, text: string): Promise<boolean> {
  return page.evaluate(
    ({ p, t }) => {
      const fn = (globalThis as { __riftySetEditorValue?: (path: string, text: string) => boolean })
        .__riftySetEditorValue;
      return fn ? fn(p, t) : false;
    },
    { p: path, t: text },
  );
}

/** Hover contents (markdown) at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsHover(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<string | null> {
  return page.evaluate(
    ({ p, l, c }) => {
      const fn = (
        globalThis as {
          __riftyTsHover?: (path: string, line: number, col: number) => Promise<string | null>;
        }
      ).__riftyTsHover;
      return fn ? fn(p, l, c) : Promise.resolve('__no_hook__');
    },
    { p: path, l: line, c: col },
  );
}

/** Definition locations at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsDefinition(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<{ uri: string; line: number; column: number }[] | null> {
  return page.evaluate(
    ({ p, l, c }) => {
      const fn = (
        globalThis as {
          __riftyTsDefinition?: (
            path: string,
            line: number,
            col: number,
          ) => Promise<{ uri: string; line: number; column: number }[] | null>;
        }
      ).__riftyTsDefinition;
      return fn ? fn(p, l, c) : Promise.resolve(null);
    },
    { p: path, l: line, c: col },
  );
}

/** Completion labels at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsCompletions(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<string[] | null> {
  return page.evaluate(
    ({ p, l, c }) => {
      const fn = (
        globalThis as {
          __riftyTsCompletions?: (
            path: string,
            line: number,
            col: number,
          ) => Promise<string[] | null>;
        }
      ).__riftyTsCompletions;
      return fn ? fn(p, l, c) : Promise.resolve(null);
    },
    { p: path, l: line, c: col },
  );
}

/** Rebuild the LS against the current owner VFS + tsconfig (idempotent ts:init; phase 2 hook). */
async function tsReinit(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const fn = (globalThis as { __riftyTsReinit?: () => Promise<boolean> }).__riftyTsReinit;
    return fn ? fn() : Promise.resolve(false);
  });
}

/**
 * Write a file in the owner store via a real `printf > path` (the SSoT the LS
 * reads). `content` is sent with real newlines folded to `\n` escapes; it must
 * contain no single-quote or `%` (printf format chars) — the project fixtures
 * below use double-quoted TS strings to honor that.
 */
async function writeOwnerFile(page: Page, path: string, content: string): Promise<void> {
  const escaped = content.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  await runTerminalLine(page, `printf '${escaped}' > ${path}`);
}

/** Open a workspace file through the real command palette (Ctrl/Cmd-K → type → click). */
async function openFileViaPalette(page: Page, filename: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.locator('[data-testid="command-palette"]');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill(filename);
  // The Files section lists the workspace file (label = workspace-relative path).
  const row = palette.locator('.rf-palette__item', { hasText: filename }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(palette).toBeHidden();
}

test.describe('rifty TS language service: real diagnostics in the playground', () => {
  test('type error → Monaco squiggle + Problems row; fix → both clear', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    // Generous: the FIRST LS request cold-boots the `typescript` engine + fetches
    // the ~3 MB vendored lib.d.ts bundle over the relay (one-time). 120s headroom.
    test.setTimeout(120_000);
    await page.goto('/');

    // Owner shell ready: terminal 1 echoes the boot dev line (same gate the
    // owner-editor spec uses). Terminal 1 then runs `vite` (blocks its prompt), so
    // open a SECOND idle shell on the same persistent owner for file commands.
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toContain('$ vite');
    await openShellTerminal(page);

    // Create an EMPTY .ts file in the owner store (the SSoT the LS reads) via a
    // real shell command — empty so the keyboard-typed error below is the SOLE
    // content (nothing to mangle). The owner republishes its snapshot on command
    // exit, so the palette then lists it.
    await runTerminalLine(page, `printf '' > ${TS_PATH}`);
    await runTerminalLine(page, 'ls /workspace/src');
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain('lsp-check.ts');

    // Open it in the editor through the real palette → an editable .ts tab. This
    // fires the page LS client's ts:open + a first diagnostics pass (empty → none).
    await openFileViaPalette(page, 'lsp-check.ts');

    // Editor opened a model for this path (hook returns >= 0 once mounted) and the
    // empty file has NO diagnostics yet.
    await expect
      .poll(() => tsMarkerCount(page, TS_PATH), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    // Introduce a REAL type error via the real Monaco input: type a single
    // `number = string` statement into the empty file. number = string ⇒ TS2322.
    // The keystroke → debounced ts:update → LS → diagnostics → marker.
    const editor = page.locator('[data-testid="editor"]');
    const input = editor.locator('textarea.inputarea').first();
    await editor.locator('.view-line').first().click();
    await expect(input).toBeFocused();
    await page.keyboard.insertText('export const bad: number = "not a number";');

    // (1) a rifty-TS Monaco marker appears. VERY generous: the FIRST request cold-
    // boots the `typescript` engine in the LS worker AND fetches the ~3 MB vendored
    // lib.d.ts bundle over the relay — one-time, slow; once warm the rest is fast.
    await expect.poll(() => tsMarkerCount(page, TS_PATH), { timeout: 70_000 }).toBeGreaterThan(0);

    // (1b) and a real error squiggle is rendered on the active model.
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({
      timeout: 15_000,
    });

    // (2) a row appears in the Problems tab.
    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect
      .poll(() => page.locator('[data-testid="problem-row"]').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // The row carries the actual TS message (number/string mismatch), not a stub.
    await expect(page.locator('[data-testid="problem-row"]').first()).toContainText(
      /number|string/i,
    );

    // Fix the error → ts:update → fresh (empty) diagnostics. A clean full-replace
    // via the model test hook (real change event, see header). BOTH the marker AND
    // the Problems row must clear.
    expect(await setModelValue(page, TS_PATH, 'export const good: number = 42;\n')).toBe(true);

    await expect.poll(() => tsMarkerCount(page, TS_PATH), { timeout: 30_000 }).toBe(0);
    await expect
      .poll(() => page.locator('[data-testid="problem-row"]').count(), { timeout: 30_000 })
      .toBe(0);
  });
});

/**
 * Phase-2 (ADR-0166 task 2.2): hover / go-to-definition / completions now come
 * from the REAL rifty LS over the page→owner→LS relay, NOT Monaco's built-in
 * `ts.worker` (retired via `setModeConfiguration`). These assertions exercise
 * REAL project + dependency knowledge the isolated lib.d.ts-only worker could
 * never have: a type that comes from a CROSS-FILE module and from a node_modules
 * `.d.ts`, a go-to-def that jumps into a sibling file AND into a dependency's
 * `.d.ts`, and a member completion whose candidates depend on tsconfig +
 * node_modules resolution.
 *
 * RED-checkable: the assertions drive the EXACT registered Monaco providers (via
 * the DEV `__riftyTs*` hooks that call `provider.provideHover/Definition/…`). Two
 * independent RED checks confirm they bind to the real pipeline:
 *  (a) unregister a provider (delete its entry in `registerTsLanguageServiceProviders`)
 *      → the corresponding hook returns null/[] → the assertion fails;
 *  (b) re-enable the built-in worker (drop `setModeConfiguration` /
 *      `disableBuiltinTsDiagnostics` won't change these — the hooks bypass the
 *      built-in worker entirely, so this suite specifically guards the rifty path).
 * Additionally, neither the cross-file type nor the node_modules symbol exists in
 * lib.d.ts, so a hover/def/completion built on the isolated worker could not
 * produce them at all.
 */
const PROJECT_DIR = '/workspace/src';
const USES_DEP = `${PROJECT_DIR}/uses-dep.ts`;
const DEP_TS = `${PROJECT_DIR}/dep.ts`;
const DEP_DTS = '/workspace/node_modules/cool-dep/index.d.ts';

test.describe('rifty TS language service: real hover/def/completions (not Monaco built-in)', () => {
  test('hover shows cross-file + node_modules types; def jumps to file + dep .d.ts; completions list dep members', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toContain('$ vite');
    await openShellTerminal(page);

    // Build a small REAL project in the owner store (the SSoT the LS reads):
    //  - tsconfig with BUNDLER module resolution so node_modules .d.ts resolves;
    //  - a fake `cool-dep` package (package.json + index.d.ts) — TS resolves it
    //    through the owner VFS node_modules, which Monaco's isolated worker can't;
    //  - a sibling `dep.ts` (cross-file types);
    //  - `uses-dep.ts` importing both.
    await writeOwnerFile(
      page,
      '/workspace/tsconfig.json',
      [
        '{',
        '  "compilerOptions": {',
        '    "target": "es2022",',
        '    "module": "esnext",',
        '    "moduleResolution": "bundler",',
        '    "strict": true,',
        '    "allowImportingTsExtensions": true,',
        '    "noEmit": true',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    await runTerminalLine(page, 'mkdir -p /workspace/node_modules/cool-dep');
    await writeOwnerFile(
      page,
      '/workspace/node_modules/cool-dep/package.json',
      ['{', '  "name": "cool-dep",', '  "types": "index.d.ts"', '}', ''].join('\n'),
    );
    await writeOwnerFile(
      page,
      DEP_DTS,
      [
        'export declare const coolValue: number;',
        'export declare function coolHelper(input: string): string;',
        'export declare const cool: { readonly helper: (x: string) => string; readonly value: number };',
        '',
      ].join('\n'),
    );
    await writeOwnerFile(
      page,
      DEP_TS,
      [
        'export function localGreet(name: string): string {',
        '  return "hi " + name;',
        '}',
        '',
      ].join('\n'),
    );
    // uses-dep.ts — 1-based lines used by the position assertions below:
    //  L1 import from "cool-dep"; L2 import from "./dep.ts";
    //  L3 `const a = coolValue;`           coolValue starts col 11
    //  L4 `const b = coolHelper("x");`
    //  L5 `const c = localGreet("y");`     localGreet starts col 11
    //  L6 `const d = cool.`                cursor after the dot = col 16
    await writeOwnerFile(
      page,
      USES_DEP,
      [
        'import { coolValue, coolHelper, cool } from "cool-dep";',
        'import { localGreet } from "./dep.ts";',
        'const a = coolValue;',
        'const b = coolHelper("x");',
        'const c = localGreet("y");',
        'const d = cool.',
        '',
      ].join('\n'),
    );
    await runTerminalLine(page, 'ls /workspace/src');
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain('uses-dep.ts');

    // Open uses-dep.ts so a Monaco model exists (providers resolve a model→path).
    await openFileViaPalette(page, 'uses-dep.ts');
    await expect
      .poll(() => tsMarkerCount(page, USES_DEP), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    // Rebuild the service against the project we just wrote (the boot build used
    // tsc default options before these files / this tsconfig existed). Idempotent
    // ts:init — a real supported operation, not a test backdoor.
    expect(await tsReinit(page)).toBe(true);

    // (1) HOVER over `coolValue` (L3, col 12). Its type comes from the
    // node_modules `.d.ts`, so the rendered hover must carry the REAL type
    // (`(alias) const coolValue: number`) — lib.d.ts alone has no `coolValue`,
    // proving project/dep knowledge. The FIRST query cold-boots the engine + ~3 MB
    // lib.d.ts over the relay AND warms the rebuilt program (the cold program's
    // first quick-info can transiently elide the alias type), so poll with a
    // spaced interval until the full type appears (1.5s spacing avoids hammering
    // the warming program; 90s headroom for the one-time lib.d.ts fetch).
    await expect
      .poll(() => tsHover(page, USES_DEP, 3, 12), { timeout: 90_000, intervals: [1500] })
      .toMatch(/coolValue[\s\S]*number/);

    // (2) GO-TO-DEFINITION of `localGreet` (L5, col 12) → the sibling dep.ts (the
    // hook round-trips the target Location.uri back to its VFS path). Cross-file
    // resolution Monaco's isolated worker can't do.
    await expect
      .poll(async () => (await tsDefinition(page, USES_DEP, 5, 12))?.[0]?.uri ?? '', {
        timeout: 30_000,
        intervals: [1500],
      })
      .toContain(DEP_TS);
    const localDefs = await tsDefinition(page, USES_DEP, 5, 12);
    expect(localDefs?.[0]?.uri).not.toContain('uses-dep.ts');
    // jumps to the declaration line (dep.ts L1, `export function localGreet`).
    expect(localDefs?.[0]?.line).toBe(1);

    // (2b) GO-TO-DEFINITION of `coolValue` (L3, col 12) → the dependency's
    // `.d.ts` under node_modules (opened read-only by `ensureModel`, path
    // recovered via `pathForModel`) — the dep-jump the isolated worker can't do.
    await expect
      .poll(async () => (await tsDefinition(page, USES_DEP, 3, 12))?.[0]?.uri ?? '', {
        timeout: 30_000,
        intervals: [1500],
      })
      .toContain(DEP_DTS);

    // (3) COMPLETIONS at the member access `cool.` (L6, col 16) — the members
    // come from the node_modules `.d.ts` type, gated on tsconfig resolution.
    await expect
      .poll(async () => (await tsCompletions(page, USES_DEP, 6, 16)) ?? [], {
        timeout: 30_000,
        intervals: [1500],
      })
      .toEqual(expect.arrayContaining(['helper', 'value']));
  });
});
