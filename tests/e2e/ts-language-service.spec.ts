import { type Page, expect, test } from '@playwright/test';
import { readWorkspaceText } from './helpers/opfs.ts';
import {
  expectViteDevServerReady,
  insertTerminalLineSettled,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

// Run this file's tests SERIALLY (override the config's fullyParallel): each test
// cold-boots its OWN workspace owner + LS grandchild and loads the workspace
// TypeScript compiler/libs. Two such cold-boots in parallel starve CPU/memory and the
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
 * over the owner VFS (workspace `node_modules/typescript`), (d) the LS→owner→page response carried
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

let ownerShellSeq = 0;

function parentDir(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runOwnerShell(
  page: Page,
  command: string,
  timeout = 15_000,
  slot: 'active' | number = 'active',
): Promise<void> {
  const seq = ++ownerShellSeq;
  const marker = `__rifty_e2e_shell_done_${seq}__`;
  await runTerminalLine(page, `${command} && printf '__rifty_e2e_shell_done_%s__\\n' ${seq}`, slot);
  await expect
    .poll(() => terminalBuffer(page, slot), { timeout })
    .toMatch(new RegExp(`${escapeRegExp(marker)}[\\s\\S]*>\\s*$`));
}

async function activeRootFromHint(page: Page): Promise<string> {
  const hint = page
    .locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal-mode-hint"]')
    .first();
  await expect(hint).toContainText('Commands run in ', { timeout: 30_000 });
  const text = (await hint.textContent()) ?? '';
  const match = text.match(/Commands run in ([^;]+);/);
  if (!match) throw new Error(`could not parse active root from mode hint: ${text}`);
  return match[1];
}

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

async function withDisposedClientFallback<T>(op: Promise<T>, fallback: T): Promise<T> {
  try {
    return await op;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ts-lsp client disposed')) return fallback;
    throw error;
  }
}

/** Hover contents (markdown) at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsHover(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<string | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c }) => {
        const fn = (
          globalThis as {
            __riftyTsHover?: (path: string, line: number, col: number) => Promise<string | null>;
          }
        ).__riftyTsHover;
        return fn ? fn(p, l, c) : Promise.resolve('__no_hook__');
      },
      { p: path, l: line, c: col },
    ),
    null,
  );
}

/** Definition locations at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsDefinition(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<{ uri: string; line: number; column: number }[] | null> {
  return withDisposedClientFallback(
    page.evaluate(
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
    ),
    null,
  );
}

/** Completion labels at a 1-based Monaco position via the registered provider (phase 2 hook). */
async function tsCompletions(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<string[] | null> {
  return withDisposedClientFallback(
    page.evaluate(
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
    ),
    null,
  );
}

async function tsCompletionItems(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<
  | {
      label: string;
      insertText: string;
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      insertTextRules?: number;
      commitCharacters: string[];
      additionalTextEditCount: number;
    }[]
  | null
> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c }) => {
        const fn = (
          globalThis as {
            __riftyTsCompletionItems?: (
              path: string,
              line: number,
              col: number,
            ) => Promise<
              | {
                  label: string;
                  insertText: string;
                  startLine: number;
                  startColumn: number;
                  endLine: number;
                  endColumn: number;
                  insertTextRules?: number;
                  commitCharacters: string[];
                  additionalTextEditCount: number;
                }[]
              | null
            >;
          }
        ).__riftyTsCompletionItems;
        return fn ? fn(p, l, c) : Promise.resolve(null);
      },
      { p: path, l: line, c: col },
    ),
    null,
  );
}

async function tsRangeSemanticTokenCount(
  page: Page,
  path: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): Promise<number | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, sl, sc, el, ec }) => {
        const fn = (
          globalThis as {
            __riftyTsRangeSemanticTokenCount?: (
              path: string,
              startLine: number,
              startCol: number,
              endLine: number,
              endCol: number,
            ) => Promise<number | null>;
          }
        ).__riftyTsRangeSemanticTokenCount;
        return fn ? fn(p, sl, sc, el, ec) : Promise.resolve(null);
      },
      { p: path, sl: startLine, sc: startCol, el: endLine, ec: endCol },
    ),
    null,
  );
}

/** Find-references at a 1-based Monaco position via the registered provider (phase 3 hook). */
async function tsReferences(
  page: Page,
  path: string,
  line: number,
  col: number,
  includeDeclaration: boolean,
): Promise<{ uri: string; line: number; column: number }[] | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c, incl }) => {
        const fn = (
          globalThis as {
            __riftyTsReferences?: (
              path: string,
              line: number,
              col: number,
              includeDeclaration: boolean,
            ) => Promise<{ uri: string; line: number; column: number }[] | null>;
          }
        ).__riftyTsReferences;
        return fn ? fn(p, l, c, incl) : Promise.resolve(null);
      },
      { p: path, l: line, c: col, incl: includeDeclaration },
    ),
    null,
  );
}

/** Prepare-rename probe at a 1-based Monaco position via the registered provider (phase 3 hook). */
async function tsPrepareRename(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<{ text: string; line: number; column: number } | { rejectReason: string } | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c }) => {
        const fn = (
          globalThis as {
            __riftyTsPrepareRename?: (
              path: string,
              line: number,
              col: number,
            ) => Promise<
              { text: string; line: number; column: number } | { rejectReason: string } | null
            >;
          }
        ).__riftyTsPrepareRename;
        return fn ? fn(p, l, c) : Promise.resolve(null);
      },
      { p: path, l: line, c: col },
    ),
    null,
  );
}

/** Rename-edits at a 1-based Monaco position via the registered provider (phase 3 hook). */
async function tsRenameEdits(
  page: Page,
  path: string,
  line: number,
  col: number,
  newName: string,
): Promise<{ uri: string; text: string; line: number; column: number }[] | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c, n }) => {
        const fn = (
          globalThis as {
            __riftyTsRenameEdits?: (
              path: string,
              line: number,
              col: number,
              newName: string,
            ) => Promise<{ uri: string; text: string; line: number; column: number }[] | null>;
          }
        ).__riftyTsRenameEdits;
        return fn ? fn(p, l, c, n) : Promise.resolve(null);
      },
      { p: path, l: line, c: col, n: newName },
    ),
    null,
  );
}

/** Signature-help at a 1-based Monaco position via the registered provider (phase 3 hook). */
async function tsSignatureHelp(
  page: Page,
  path: string,
  line: number,
  col: number,
): Promise<{ label: string; activeSignature: number; activeParameter: number } | null> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, l, c }) => {
        const fn = (
          globalThis as {
            __riftyTsSignatureHelp?: (
              path: string,
              line: number,
              col: number,
            ) => Promise<{
              label: string;
              activeSignature: number;
              activeParameter: number;
            } | null>;
          }
        ).__riftyTsSignatureHelp;
        return fn ? fn(p, l, c) : Promise.resolve(null);
      },
      { p: path, l: line, c: col },
    ),
    null,
  );
}

/** Quick-fixes over a 1-based Monaco range via the registered code-action provider (phase 4 hook). */
async function tsCodeFixes(
  page: Page,
  path: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): Promise<{ title: string; kind?: string; edits: { uri: string; text: string }[] }[]> {
  return withDisposedClientFallback(
    page.evaluate(
      ({ p, sl, sc, el, ec }) => {
        const fn = (
          globalThis as {
            __riftyTsCodeFixes?: (
              path: string,
              startLine: number,
              startCol: number,
              endLine: number,
              endCol: number,
            ) => Promise<
              { title: string; kind?: string; edits: { uri: string; text: string }[] }[]
            >;
          }
        ).__riftyTsCodeFixes;
        return fn ? fn(p, sl, sc, el, ec) : Promise.resolve([]);
      },
      { p: path, sl: startLine, sc: startCol, el: endLine, ec: endCol },
    ),
    [],
  );
}

/** Organize-imports source action via the registered code-action provider (phase 4 hook). */
async function tsOrganizeImports(
  page: Page,
  path: string,
): Promise<{ title: string; kind?: string; edits: { uri: string; text: string }[] } | null> {
  return withDisposedClientFallback(
    page.evaluate((p) => {
      const fn = (
        globalThis as {
          __riftyTsOrganizeImports?: (path: string) => Promise<{
            title: string;
            kind?: string;
            edits: { uri: string; text: string }[];
          } | null>;
        }
      ).__riftyTsOrganizeImports;
      return fn ? fn(p) : Promise.resolve(null);
    }, path),
    null,
  );
}

/**
 * Whole-document format via the registered formatting provider (phase 4 hook).
 * Returns the edit count + the text AFTER applying the edits (tsserver returns
 * span edits, not a whole-doc replace, so the applied result is asserted on).
 */
async function tsFormat(
  page: Page,
  path: string,
): Promise<{ editCount: number; applied: string } | null> {
  return withDisposedClientFallback(
    page.evaluate((p) => {
      const fn = (
        globalThis as {
          __riftyTsFormat?: (
            path: string,
          ) => Promise<{ editCount: number; applied: string } | null>;
        }
      ).__riftyTsFormat;
      return fn ? fn(p) : Promise.resolve(null);
    }, path),
    null,
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
 * reads). Long fixture writes use `insertText`, not per-key typing: under a
 * fully parallel browser run, `keyboard.type()` can drop characters and turn a
 * valid fixture write into a later, confusing LS failure.
 */
async function writeOwnerFile(
  page: Page,
  path: string,
  content: string,
  slot: 'active' | number = 'active',
): Promise<void> {
  const escaped = content.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/'/g, "'\\''");
  await insertTerminalLineSettled(
    page,
    `mkdir -p ${parentDir(path)} && printf '${escaped}' > ${path}`,
    30_000,
    slot,
  );
}

async function waitForSrcSnapshotFile(page: Page, filename: string): Promise<void> {
  const src = page.getByRole('treeitem', { name: 'src' }).first();
  await expect(src).toBeVisible({ timeout: 30_000 });
  if ((await src.getAttribute('aria-expanded')) !== 'true') await src.click();
  await expect(page.getByRole('treeitem', { name: filename }).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function pickStarterAndWaitForTemplate(
  page: Page,
  preset: string,
  editorNeedle: string,
  previewNeedle: string,
): Promise<void> {
  const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
  const previewBody = page.frameLocator('iframe[title="Preview port 5174"]').locator('body');
  await pickStarter(page, preset);
  await expect.poll(() => terminalBuffer(page), { timeout: 45_000 }).toContain('$ vite');
  await expect(editorLines).toContainText(editorNeedle, { timeout: 45_000 });
  await expect
    .poll(() => fetchPreviewOk(page, 5174), {
      timeout: 90_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);
  try {
    await expect(previewBody).toContainText(previewNeedle, { timeout: 30_000 });
  } catch (error) {
    await page.getByRole('button', { name: 'Reload preview' }).click();
    await expect(previewBody).toContainText(previewNeedle, { timeout: 60_000 });
  }
}

async function pickTypeScriptStarter(page: Page): Promise<void> {
  await pickStarterAndWaitForTemplate(
    page,
    'typescript-ls',
    'LibraryShape',
    'TypeScript language surface',
  );
}

async function fetchPreviewOk(page: Page, port: number): Promise<boolean> {
  return page.evaluate(async (targetPort) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4_000);
    try {
      const r = await fetch(`/preview/${targetPort}/`, { cache: 'no-store', signal: ac.signal });
      return r.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, port);
}

async function fetchPreviewText(
  page: Page,
  port: number,
  path: string,
  options: { readonly cacheBust?: boolean } = {},
): Promise<string> {
  return page.evaluate(
    async ({ targetPort, targetPath, cacheBust }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4_000);
      try {
        const suffix = cacheBust ? `?rifty_e2e=${Date.now()}` : '';
        const r = await fetch(`/preview/${targetPort}${targetPath}${suffix}`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!r.ok) return `HTTP:${r.status}`;
        return await r.text();
      } catch (err) {
        return `ERROR:${(err as Error).name}`;
      } finally {
        clearTimeout(timer);
      }
    },
    { targetPort: port, targetPath: path, cacheBust: options.cacheBust ?? true },
  );
}

async function waitForTypeScriptStarterDevServer(page: Page): Promise<void> {
  await expectViteDevServerReady(page, 5174, 30_000);
}

/** Open a workspace file through the real command palette (Ctrl/Cmd-K → type → click). */
async function openFileViaPalette(page: Page, filename: string): Promise<void> {
  // Palette items are snapshotted once when the palette opens. Wait for the
  // owner-published page snapshot first; waiting inside an already-open palette
  // would never see a later snapshot frame.
  await waitForSrcSnapshotFile(page, filename);
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.locator('[data-testid="command-palette"]');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill(filename);
  // The Files section lists the workspace file (label = workspace-relative path).
  const row = palette.locator('.rf-palette__item', { hasText: filename }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(palette).toBeHidden();
}

test.describe('rifty TS language service: real diagnostics in the playground', () => {
  test('type error → Monaco squiggle + Problems row; fix → both clear', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    // Generous: the FIRST LS request cold-boots the workspace `typescript` engine
    // and loads its lib.d.ts files over the relay (one-time). 150s headroom.
    test.setTimeout(150_000);
    await page.goto('/');
    await pickTypeScriptStarter(page);

    // Owner shell ready: terminal 1 runs `vite` (blocks its prompt), so open a
    // SECOND idle shell on the same persistent owner for file commands.
    await waitForTypeScriptStarterDevServer(page);
    const root = await activeRootFromHint(page);
    const tsPath = `${root}/src/lsp-check.ts`;
    const shellSlot = await openShellTerminal(page);

    // Create an EMPTY .ts file in the owner store (the SSoT the LS reads) via a
    // real shell command — empty so the keyboard-typed error below is the SOLE
    // content (nothing to mangle). The owner republishes its snapshot on command
    // exit, so the palette then lists it.
    await runOwnerShell(
      page,
      `mkdir -p ${parentDir(tsPath)} && printf '' > ${tsPath} && ls ${root}/src`,
      15_000,
      shellSlot,
    );
    await expect
      .poll(() => terminalBuffer(page, shellSlot), { timeout: 15_000 })
      .toContain('lsp-check.ts');

    // Open it in the editor through the real palette → an editable .ts tab. This
    // fires the page LS client's ts:open + a first diagnostics pass (empty → none).
    await openFileViaPalette(page, 'lsp-check.ts');

    // Editor opened a model for this path (hook returns >= 0 once mounted) and the
    // empty file has NO diagnostics yet.
    await expect
      .poll(() => tsMarkerCount(page, tsPath), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);
    expect(await tsReinit(page)).toBe(true);

    // Introduce a REAL type error via the real Monaco input: type a single
    // `number = string` statement into the empty file. number = string ⇒ TS2322.
    // The keystroke → debounced ts:update → LS → diagnostics → marker.
    const editor = page.locator('[data-testid="editor"]');
    const input = editor.locator('textarea.inputarea').first();
    await editor.locator('.view-line').first().click();
    await expect(input).toBeFocused();
    await page.keyboard.insertText('export const bad: number = "not a number";');

    // (1) a rifty-TS Monaco marker appears. VERY generous: the FIRST request cold-
    // boots the workspace `typescript` engine in the LS worker AND loads lib.d.ts
    // over the relay — one-time, slow; once warm the rest is fast.
    await expect.poll(() => tsMarkerCount(page, tsPath), { timeout: 100_000 }).toBeGreaterThan(0);

    // (1b) and a real error squiggle is rendered on the active model.
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({
      timeout: 15_000,
    });

    // (2) a row appears in the Problems tab.
    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="terminal"]')).toBeHidden();
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
    expect(await setModelValue(page, tsPath, 'export const good: number = 42;\n')).toBe(true);

    await expect.poll(() => tsMarkerCount(page, tsPath), { timeout: 30_000 }).toBe(0);
    await expect
      .poll(() => page.locator('[data-testid="problem-row"]').count(), { timeout: 30_000 })
      .toBe(0);
  });
});

test.describe('rifty TS language service: TypeScript starter wiring', () => {
  test('typescript-ls entry file tab writes the template main.ts that Vite serves', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');

    await pickStarterAndWaitForTemplate(
      page,
      'typescript-ls',
      'LibraryShape',
      'TypeScript language surface',
    );
    const root = await activeRootFromHint(page);
    const mainTs = `${root}/src/main.ts`;
    const formatTs = `${root}/src/format.ts`;
    const exampleTypesDts = `${root}/node_modules/@rifty/example-types/index.d.ts`;
    const editor = page.locator('[data-testid="editor"]');
    const input = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    // The TypeScript starter entry is already the active initial file tab; checking
    // the visible Monaco lines avoids racing the palette's async file index.
    await expect(editorLines).toContainText('LibraryShape', { timeout: 45_000 });
    await expect
      .poll(
        async () => (await tsDefinition(page, mainTs, 1, 15))?.map((d) => d.uri).join('\n') ?? '',
        {
          timeout: 90_000,
          intervals: [1500],
        },
      )
      .toContain(exampleTypesDts);
    await expect
      .poll(async () => (await tsDefinition(page, mainTs, 3, 10))?.[0]?.uri ?? '', {
        timeout: 90_000,
        intervals: [1500],
      })
      .toContain(formatTs);
    const exampleTypesTab = page.getByRole('tab', { name: /index\.d\.ts/ }).first();
    await expect(exampleTypesTab).toBeVisible({ timeout: 30_000 });
    await exampleTypesTab.click();
    await expect(exampleTypesTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(editorLines).toContainText('interface LibraryShape', { timeout: 30_000 });
    await page
      .getByRole('tab', { name: /main\.ts/ })
      .first()
      .click();
    await expect(editorLines).toContainText('LibraryShape', { timeout: 10_000 });

    expect(
      await setModelValue(
        page,
        mainTs,
        [
          "import type { LibraryShape } from '@rifty/example-types';",
          'const broken: LibraryShape = { id: 123, labels: [123] };',
          '',
        ].join('\n'),
      ),
    ).toBe(true);
    await expect(editorLines).toContainText('broken', { timeout: 10_000 });
    await expect.poll(() => tsMarkerCount(page, mainTs), { timeout: 90_000 }).toBeGreaterThan(0);
    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problem-row"]').first()).toContainText(
      /number|string/i,
      { timeout: 30_000 },
    );

    const frame = page.frameLocator('iframe[title="Preview port 5174"]');

    expect(
      await setModelValue(
        page,
        mainTs,
        [
          "const app = document.getElementById('app');",
          "if (!app) throw new Error('Missing #app root');",
          "app.textContent = 'rifty-ts-main-ts-hot';",
          'if (import.meta.hot) import.meta.hot.accept();',
          '',
        ].join('\n'),
      ),
    ).toBe(true);
    await expect
      .poll(() => readWorkspaceText(page, mainTs), { timeout: 30_000 })
      .toContain('rifty-ts-main-ts-hot');
    await expect
      .poll(() => fetchPreviewText(page, 5174, '/src/main.ts', { cacheBust: false }), {
        timeout: 60_000,
        intervals: [500, 1_000, 2_000],
      })
      .toContain('rifty-ts-main-ts-hot');
    await page.getByRole('button', { name: 'Reload preview' }).click();

    await expect(frame.locator('body')).toContainText('rifty-ts-main-ts-hot', {
      timeout: 90_000,
    });

    await expect.poll(() => tsMarkerCount(page, mainTs), { timeout: 90_000 }).toBe(0);
    await editor.locator('.view-line').first().click();
    await expect(input).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('const typedBusted: number = "nope";\n');
    await expect(editorLines).toContainText('typedBusted', { timeout: 10_000 });
    await expect.poll(() => tsMarkerCount(page, mainTs), { timeout: 90_000 }).toBeGreaterThan(0);
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="terminal"]')).toBeHidden();
    await expect(page.locator('[data-testid="problem-row"]').first()).toContainText(
      /number|string/i,
      { timeout: 30_000 },
    );
  });

  test('rapid entry-file edits debounce owner writes so Vite emits one HMR burst, not one line per content event', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');

    await pickStarterAndWaitForTemplate(
      page,
      'typescript-ls',
      'LibraryShape',
      'TypeScript language surface',
    );
    const root = await activeRootFromHint(page);
    const mainTs = `${root}/src/main.ts`;
    const before = await terminalBuffer(page);
    for (let i = 0; i < 12; i += 1) {
      expect(
        await setModelValue(
          page,
          mainTs,
          [
            "const app = document.getElementById('app');",
            "if (!app) throw new Error('Missing #app root');",
            `app.textContent = 'hmr-debounce-${i}';`,
            'if (import.meta.hot) import.meta.hot.accept();',
            '',
          ].join('\n'),
        ),
      ).toBe(true);
    }
    await expect(
      page.frameLocator('iframe[title="Preview port 5174"]').locator('body'),
    ).toContainText('hmr-debounce-11', { timeout: 90_000 });
    const after = await terminalBuffer(page);
    const updates = after
      .slice(before.length)
      .split('\n')
      .filter((line) => line.includes('[vite] hmr update /src/main.ts')).length;
    expect(updates).toBeLessThanOrEqual(2);
  });
});

/**
 * Phase-2 (ADR-0166 task 2.2): hover / go-to-definition / completions now come
 * from the REAL rifty LS over the page→owner→LS relay, NOT Monaco's built-in
 * `ts.worker` (retired via `setModeConfiguration`). These assertions exercise
 * REAL project + dependency knowledge the isolated lib.d.ts-only worker could
 * never have: hover over a node_modules `.d.ts` symbol, go-to-def into a sibling
 * file, and member completion whose candidates depend on sibling project type
 * resolution.
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
 * lib.d.ts, so a hover/def/completion path built on the isolated worker could not
 * satisfy these assertions.
 */
function dependencyProjectPaths(root: string): {
  usesDep: string;
  depTs: string;
  depDts: string;
} {
  const projectDir = `${root}/src`;
  return {
    usesDep: `${projectDir}/uses-dep.ts`,
    depTs: `${projectDir}/dep.ts`,
    depDts: `${root}/node_modules/cool-dep/index.d.ts`,
  };
}
const usesDepResolvedSource = [
  'import { coolValue, coolHelper, cool } from "cool-dep";',
  'import { localGreet } from "./dep.ts";',
  'const a = coolValue;',
  'const b = coolHelper("x");',
  'const c = localGreet("y");',
  'const d = cool.value;',
  '',
].join('\n');
const usesDepCompletionSource = [
  'import { coolValue, coolHelper, cool } from "cool-dep";',
  'import { localGreet } from "./dep.ts";',
  'const a = coolValue;',
  'const b = coolHelper("x");',
  'const c = localGreet("y");',
  'const d = cool.',
  '',
].join('\n');

test.describe('rifty TS language service: real hover/def/completions (not Monaco built-in)', () => {
  test('hover shows project symbols; def jumps to a sibling file; completions list typed members', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');
    await pickTypeScriptStarter(page);

    await waitForTypeScriptStarterDevServer(page);
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 90_000 });
    const root = await activeRootFromHint(page);
    const { usesDep, depTs, depDts } = dependencyProjectPaths(root);
    const shellSlot = await openShellTerminal(page);

    // Build a small REAL project in the owner store (the SSoT the LS reads):
    //  - tsconfig with BUNDLER module resolution so node_modules .d.ts resolves;
    //  - a fake `cool-dep` package (package.json + index.d.ts) — TS resolves it
    //    through the owner VFS node_modules, which Monaco's isolated worker can't;
    //  - a sibling `dep.ts` (cross-file types);
    //  - `uses-dep.ts` importing both.
    await writeOwnerFile(
      page,
      `${root}/tsconfig.json`,
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
      shellSlot,
    );
    await writeOwnerFile(
      page,
      `${root}/node_modules/cool-dep/package.json`,
      ['{', '  "name": "cool-dep",', '  "types": "index.d.ts"', '}', ''].join('\n'),
      shellSlot,
    );
    await writeOwnerFile(
      page,
      depDts,
      [
        'export declare const coolValue: number;',
        'export declare function coolHelper(input: string): string;',
        'export declare const cool: { readonly helper: (x: string) => string; readonly value: number };',
        '',
      ].join('\n'),
      shellSlot,
    );
    await writeOwnerFile(
      page,
      depTs,
      [
        'export function localGreet(name: string): string {',
        '  return "hi " + name;',
        '}',
        'export const localCool = {',
        '  helper(input: string): string { return input.toUpperCase(); },',
        '  value: 42,',
        '} as const;',
        '',
      ].join('\n'),
      shellSlot,
    );
    // uses-dep.ts — 1-based lines used by the position assertions below:
    //  L1 import from "cool-dep"; L2 import from "./dep.ts";
    //  L3 `const a = coolValue;`           coolValue starts col 11
    //  L4 `const b = coolHelper("x");`
    //  L5 `const c = localGreet("y");`     localGreet starts col 11
    //  L6 `const d = cool.value;`          completion switches this to `cool.`
    await writeOwnerFile(page, usesDep, usesDepResolvedSource, shellSlot);
    await runOwnerShell(page, `cat ${depDts} && ls ${root}/src`, 15_000, shellSlot);
    await expect
      .poll(() => terminalBuffer(page, shellSlot), { timeout: 15_000 })
      .toContain('coolValue');
    await expect
      .poll(() => terminalBuffer(page, shellSlot), { timeout: 15_000 })
      .toContain('uses-dep.ts');

    // Open uses-dep.ts so a Monaco model exists (providers resolve a model→path).
    await openFileViaPalette(page, 'uses-dep.ts');
    await expect
      .poll(() => tsMarkerCount(page, usesDep), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    let depDefs: { uri: string; line: number; column: number }[] = [];
    expect(await setModelValue(page, usesDep, usesDepResolvedSource)).toBe(true);
    // Rebuild after the file is open and mirrored, so the provider query below is
    // served by the project configured with bundler resolution + fake node_modules.
    expect(await tsReinit(page)).toBe(true);
    await expect
      .poll(() => tsMarkerCount(page, usesDep), { timeout: 120_000, intervals: [1500] })
      .toBe(0);
    const depDefinitionProbes = [
      { line: 3, col: 12 }, // usage alias
      { line: 1, col: 10 }, // import binding
      { line: 1, col: 46 }, // module specifier
    ];
    await expect
      .poll(
        async () => {
          depDefs = [];
          for (const probe of depDefinitionProbes) {
            depDefs = (await tsDefinition(page, usesDep, probe.line, probe.col)) ?? [];
            if (depDefs.some((d) => d.uri.includes(depDts))) return depDefs.map((d) => d.uri);
          }
          return depDefs.map((d) => d.uri);
        },
        { timeout: 120_000, intervals: [1500] },
      )
      .toContain(depDts);

    // (1) HOVER over `coolValue` (L3, col 12). TS 5.9 renders this imported
    // alias as `import coolValue`; the dependency `.d.ts` proof is the definition
    // jump below. The FIRST query cold-boots the engine + workspace lib.d.ts over the
    // relay, so poll with a spaced interval.
    await expect
      .poll(() => tsHover(page, usesDep, 3, 12), { timeout: 90_000, intervals: [1500] })
      .toContain('coolValue');

    // (2a) GO-TO-DEFINITION of `coolValue` (L3, col 12) → node_modules .d.ts.
    // This specifically exercises the EditorHost read-only remote-port branch:
    // the page snapshot excludes node_modules, so the provider must ask the owner
    // read-port to open the target model instead of silently dropping the Location.
    const depDef = depDefs.find((d) => d.uri.includes(depDts));
    expect(depDef?.uri).toContain(depDts);
    expect(depDef?.line).toBe(1);

    // (2b) GO-TO-DEFINITION of `localGreet` (L5, col 12) → the sibling dep.ts (the
    // hook round-trips the target Location.uri back to its VFS path). Cross-file
    // resolution Monaco's isolated worker can't do.
    await expect
      .poll(async () => (await tsDefinition(page, usesDep, 5, 12))?.[0]?.uri ?? '', {
        timeout: 30_000,
        intervals: [1500],
      })
      .toContain(depTs);
    const localDefs = await tsDefinition(page, usesDep, 5, 12);
    expect(localDefs?.[0]?.uri).not.toContain('uses-dep.ts');
    // jumps to the declaration line (dep.ts L1, `export function localGreet`).
    expect(localDefs?.[0]?.line).toBe(1);

    // (3) COMPLETIONS at the member access `cool.` (L6, col 16). Keep the file
    // syntactically valid for hover/definition above, then make it incomplete only
    // for this completion assertion.
    expect(await setModelValue(page, usesDep, usesDepCompletionSource)).toBe(true);
    await expect
      .poll(() => tsMarkerCount(page, usesDep), { timeout: 60_000, intervals: [1500] })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await tsCompletions(page, usesDep, 6, 16)) ?? [], {
        timeout: 60_000,
        intervals: [1500],
      })
      .toEqual(expect.arrayContaining(['helper', 'value']));
    const completionItems = (await tsCompletionItems(page, usesDep, 6, 16)) ?? [];
    const helperCompletion = completionItems.find((item) => item.label === 'helper');
    expect(helperCompletion).toMatchObject({
      insertText: 'helper',
      startLine: 6,
      startColumn: 16,
      endLine: 6,
      endColumn: 16,
    });
    expect(helperCompletion?.commitCharacters.length ?? 0).toBeGreaterThan(0);
    await expect
      .poll(async () => tsRangeSemanticTokenCount(page, usesDep, 1, 1, 6, 16), {
        timeout: 60_000,
        intervals: [1500],
      })
      .toBeGreaterThan(0);
  });
});

/**
 * Phase-3 (ADR-0166 task 3.2): find-references / rename / signature-help now come
 * from the REAL rifty LS over the page→owner→LS relay, NOT Monaco's built-in
 * `ts.worker` (whose references/rename/signatureHelp are retired via
 * `setModeConfiguration`). These assertions exercise CROSS-FILE project knowledge
 * the isolated lib.d.ts-only worker could never have: references that span two
 * files, a rename whose WorkspaceEdit touches both files with the new text, and
 * signature help at a call site mid-args.
 *
 * RED-checkable: the assertions drive the EXACT registered Monaco providers (via
 * the DEV `__riftyTs{References,PrepareRename,RenameEdits,SignatureHelp}` hooks
 * that call `provider.provideReferences/provideRenameEdits/resolveRenameLocation/
 * provideSignatureHelp`). Each binds to the real pipeline:
 *  - references: unregister the provider (delete `reference` from
 *    `registerTsLanguageServiceProviders`) → the hook returns null → the
 *    cross-file count assertion fails; a single-file-only result (no app.ts uses)
 *    also fails the `>= 2 files` assertion;
 *  - rename: a stub that edited only the active file would fail the `both files
 *    touched` assertion; a wrong newText would fail the text assertion;
 *  - signature-help: the label / activeParameter come from the real overload
 *    resolution; an empty/absent provider returns null and the assertion fails.
 * None of `greet`/`localGreet` exist in lib.d.ts, so a built-in-worker reference/
 * rename/signature built on the isolated model could not produce them at all.
 */
function referencesProjectPaths(root: string): {
  greeterTs: string;
  appTs: string;
} {
  const projectDir = `${root}/src`;
  return {
    greeterTs: `${projectDir}/greeter.ts`,
    appTs: `${projectDir}/app.ts`,
  };
}

test.describe('rifty TS language service: real references/rename/signature-help (not Monaco built-in)', () => {
  test('references span two files (declaration drop honored); rename edits both files; signature help at a call site', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');
    await pickTypeScriptStarter(page);

    await waitForTypeScriptStarterDevServer(page);
    const root = await activeRootFromHint(page);
    const { greeterTs, appTs } = referencesProjectPaths(root);
    const shellSlot = await openShellTerminal(page);

    // Build a small REAL cross-file project in the owner store (the SSoT the LS
    // reads): a tsconfig (bundler resolution + ts-extension imports), a `greeter.ts`
    // declaring `localGreet`, and an `app.ts` importing + calling it twice. So the
    // symbol `localGreet` has uses in TWO files — references the isolated worker,
    // which sees neither file, could never surface.
    await writeOwnerFile(
      page,
      `${root}/tsconfig.json`,
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
      shellSlot,
    );
    // greeter.ts — 1-based:
    //  L1 `export function localGreet(name: string): string {`  localGreet @ col 17
    await writeOwnerFile(
      page,
      greeterTs,
      [
        'export function localGreet(name: string): string {',
        '  return "hi " + name;',
        '}',
        '',
      ].join('\n'),
      shellSlot,
    );
    // app.ts — 1-based lines used by the position assertions below:
    //  L1 `import { localGreet } from "./greeter.ts";`  localGreet @ col 10
    //  L2 `const a = localGreet("ann");`                localGreet @ col 11; "(" @ col 21
    //  L3 `const b = localGreet("bob");`                localGreet @ col 11
    await writeOwnerFile(
      page,
      appTs,
      [
        'import { localGreet } from "./greeter.ts";',
        'const a = localGreet("ann");',
        'const b = localGreet("bob");',
        'export const both = a + b;',
        '',
      ].join('\n'),
      shellSlot,
    );
    await runOwnerShell(page, `ls ${root}/src`, 15_000, shellSlot);
    await expect
      .poll(() => terminalBuffer(page, shellSlot), { timeout: 15_000 })
      .toContain('app.ts');

    // Open BOTH files so a Monaco model exists for each (providers resolve a
    // model→path; a reference/rename target in the other file resolves via
    // ensureModel, but opening both makes the round-trip path deterministic).
    await openFileViaPalette(page, 'greeter.ts');
    await openFileViaPalette(page, 'app.ts');
    await expect
      .poll(() => tsMarkerCount(page, appTs), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    // Rebuild the service against the project we just wrote (the boot build used
    // tsc default options before these files / this tsconfig existed). Idempotent.
    expect(await tsReinit(page)).toBe(true);

    // (1) FIND-REFERENCES of `localGreet` from its declaration in greeter.ts
    // (L1, col 17), includeDeclaration:true. The FIRST query cold-boots the engine
    // + workspace lib.d.ts over the relay AND warms the rebuilt program, so poll with a
    // spaced interval until references from BOTH files appear (90s headroom).
    await expect
      .poll(
        async () => {
          const refs = (await tsReferences(page, greeterTs, 1, 17, true)) ?? [];
          return new Set(refs.map((r) => r.uri.replace(/^.*\/src\//, 'src/'))).size;
        },
        { timeout: 90_000, intervals: [1500] },
      )
      .toBeGreaterThanOrEqual(2);

    // The references include uses in BOTH greeter.ts and app.ts (cross-file).
    const withDecl = (await tsReferences(page, greeterTs, 1, 17, true)) ?? [];
    const declFiles = new Set(withDecl.map((r) => r.uri));
    expect([...declFiles].some((u) => u.includes('greeter.ts'))).toBe(true);
    expect([...declFiles].some((u) => u.includes('app.ts'))).toBe(true);
    // app.ts has 3 uses (import + 2 calls); greeter.ts has the declaration ⇒ >= 4.
    const declCount = withDecl.length;
    expect(declCount).toBeGreaterThanOrEqual(4);

    // includeDeclaration:false drops the declaration site (greeter.ts L1): strictly
    // fewer results, and none of them is the declaration line in greeter.ts.
    const noDecl = (await tsReferences(page, greeterTs, 1, 17, false)) ?? [];
    expect(noDecl.length).toBe(declCount - 1);
    expect(noDecl.some((r) => r.uri.includes('greeter.ts') && r.line === 1)).toBe(false);
    // app.ts uses survive the declaration drop (cross-file refs are NOT the decl).
    expect(noDecl.some((r) => r.uri.includes('app.ts'))).toBe(true);

    // (2) PREPARE-RENAME at a use site in app.ts (L2, col 11) → renameable, the box
    // seeds with the current symbol name.
    const prepared = await tsPrepareRename(page, appTs, 2, 11);
    expect(prepared).not.toBeNull();
    expect(prepared && 'text' in prepared ? prepared.text : '').toBe('localGreet');

    // (2b) RENAME `localGreet` → `greetUser` from its DECLARATION in greeter.ts
    // (L1, col 17). Renaming the export updates the declaration AND every importer,
    // so the returned WorkspaceEdit must touch BOTH files, each edit carrying the
    // new text — cross-file rename the isolated worker can't do. (Renaming from a
    // *use* site instead would, per real TS, rewrite only the importing file's
    // local binding to `localGreet as greetUser` — the export rename is the genuine
    // cross-file edit.)
    const edits = (await tsRenameEdits(page, greeterTs, 1, 17, 'greetUser')) ?? [];
    const editFiles = new Set(edits.map((e) => e.uri));
    expect([...editFiles].some((u) => u.includes('greeter.ts'))).toBe(true);
    expect([...editFiles].some((u) => u.includes('app.ts'))).toBe(true);
    // Every edit replaces the old span with the new name (declaration + 3 app.ts
    // uses ⇒ >= 4).
    expect(edits.length).toBeGreaterThanOrEqual(4);
    expect(edits.every((e) => e.text === 'greetUser')).toBe(true);

    // (3) SIGNATURE-HELP at the call site `localGreet(` in app.ts (L2, col 22 — just
    // inside the open paren, on the first argument). The signature label carries the
    // real parameter (`name: string`) from greeter.ts, and activeParameter is 0.
    const help = await tsSignatureHelp(page, appTs, 2, 22);
    expect(help).not.toBeNull();
    expect(help?.label).toMatch(/name:\s*string/);
    expect(help?.activeParameter).toBe(0);
  });
});

/**
 * Phase-4 (ADR-0166 task 4.2): code-actions/quick-fixes, organize-imports, and
 * formatting now come from the REAL rifty LS over the page→owner→LS relay, NOT
 * Monaco's built-in `ts.worker` (whose formatting is retired in EditorHost via
 * `setModeConfiguration`, and whose code-actions were already off). These
 * assertions exercise CROSS-FILE / project knowledge the isolated lib.d.ts-only
 * worker could never have: a missing-import quick-fix that adds an import from a
 * SIBLING file, an organize-imports that sorts + drops an unused import, and a
 * whole-document format that rewrites bad spacing per tsserver defaults.
 *
 * RED-checkable: the assertions drive the EXACT registered Monaco providers (via
 * the DEV `__riftyTs{CodeFixes,OrganizeImports,Format}` hooks that call
 * `provider.provideCodeActions / provideDocumentFormattingEdits`). Each binds to
 * the real pipeline:
 *  - quick-fix: unregister the `codeAction` provider (delete it in
 *    `registerTsLanguageServiceProviders`) → the hook returns [] → the
 *    non-empty-edit assertion fails; a stub that ignored the marker's errorCodes
 *    would return no add-import fix (the `quickfix` kind + the './greeter' edit
 *    text would be absent); the import target (`./greeter`) only exists because
 *    the LS sees the sibling file — the isolated worker can't.
 *  - organize-imports: a stub returning an empty edit fails the `>0 edits`
 *    assertion; the sorted/unused-dropped result text proves the real source action.
 *  - format: disable the `documentFormatting` provider → the hook returns null →
 *    the `>0 edits` assertion fails; the rewritten spacing proves the real edits.
 * None of `localGreet`/`coolGreet` exist in lib.d.ts, so a built-in-worker fix
 * built on the isolated model could not produce the cross-file import at all.
 */
function codeActionProjectPaths(root: string): {
  fixGreeter: string;
  fixApp: string;
  organizeTs: string;
  formatTs: string;
} {
  const fixDir = `${root}/src`;
  return {
    fixGreeter: `${fixDir}/greeter.ts`,
    fixApp: `${fixDir}/app.ts`,
    organizeTs: `${fixDir}/organize.ts`,
    formatTs: `${fixDir}/format.ts`,
  };
}

test.describe('rifty TS language service: real quick-fixes/organize-imports/formatting (not Monaco built-in)', () => {
  test('missing-import quick-fix adds an import from a sibling; organize-imports sorts+drops unused; format-document fixes spacing', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');
    await pickTypeScriptStarter(page);

    await waitForTypeScriptStarterDevServer(page);
    const root = await activeRootFromHint(page);
    const { fixGreeter, fixApp, organizeTs, formatTs } = codeActionProjectPaths(root);
    const shellSlot = await openShellTerminal(page);

    // A small REAL cross-file project in the owner store (the SSoT the LS reads):
    //  - tsconfig (bundler resolution + ts-extension imports);
    //  - greeter.ts exporting `localGreet` (the missing-import target);
    //  - app.ts using `localGreet` WITHOUT importing it → TS "Cannot find name"
    //    diagnostic whose quick-fix is "add import from './greeter'";
    //  - organize.ts with an UNSORTED + partly-unused import set;
    //  - format.ts with deliberately bad spacing.
    await writeOwnerFile(
      page,
      `${root}/tsconfig.json`,
      [
        '{',
        '  "compilerOptions": {',
        '    "target": "es2022",',
        '    "module": "esnext",',
        '    "moduleResolution": "bundler",',
        '    "strict": true,',
        '    "allowImportingTsExtensions": true,',
        '    "noUnusedLocals": true,',
        '    "noEmit": true',
        '  }',
        '}',
        '',
      ].join('\n'),
      shellSlot,
    );
    await writeOwnerFile(
      page,
      fixGreeter,
      [
        'export function localGreet(name: string): string {',
        '  return "hi " + name;',
        '}',
        'export const VERSION = 1;',
        '',
      ].join('\n'),
      shellSlot,
    );
    // app.ts — `localGreet` is used (L1) but never imported ⇒ TS2304/TS2552.
    //  L1 `const a = localGreet("x");`  localGreet @ col 11
    await writeOwnerFile(
      page,
      fixApp,
      ['const a = localGreet("x");', 'export const out = a;', ''].join('\n'),
      shellSlot,
    );
    // organize.ts — imports out of order (VERSION before localGreet) and one
    // unused (`VERSION` is never referenced) ⇒ organize sorts + drops it.
    await writeOwnerFile(
      page,
      organizeTs,
      [
        'import { VERSION, localGreet } from "./greeter.ts";',
        'export const g = localGreet("y");',
        '',
      ].join('\n'),
      shellSlot,
    );
    // format.ts — bad spacing (collapsed operators / no space after comma) that
    // tsserver's default format settings rewrite.
    await writeOwnerFile(
      page,
      formatTs,
      ['export const sum=(a:number,b:number)=>a+b;', 'export const v=sum(1,2);', ''].join('\n'),
      shellSlot,
    );
    await runOwnerShell(page, `ls ${root}/src`, 15_000, shellSlot);
    await expect
      .poll(() => terminalBuffer(page, shellSlot), { timeout: 15_000 })
      .toContain('app.ts');

    // Open all four files so a Monaco model exists for each (providers resolve a
    // model→path; the add-import target resolves via ensureModel).
    await openFileViaPalette(page, 'greeter.ts');
    await openFileViaPalette(page, 'app.ts');
    await openFileViaPalette(page, 'organize.ts');
    await openFileViaPalette(page, 'format.ts');
    await expect
      .poll(() => tsMarkerCount(page, fixApp), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    // Rebuild the service against the project we just wrote (the boot build used
    // tsc default options before these files / this tsconfig existed). Idempotent.
    expect(await tsReinit(page)).toBe(true);

    // The "Cannot find name 'localGreet'" diagnostic must land first — the
    // quick-fix is sourced from THAT marker's code (FIRST request cold-boots the
    // engine + workspace lib.d.ts; 90s headroom).
    await expect.poll(() => tsMarkerCount(page, fixApp), { timeout: 90_000 }).toBeGreaterThan(0);

    // (1) QUICK-FIX over the `localGreet` use in app.ts (L1, cols 11..21). The
    // provider sources the errorCodes from the overlapping rifty marker, so an
    // "add import" quick-fix appears whose edit inserts an import of `localGreet`
    // from the sibling './greeter'. Cross-file fix the isolated worker can't do.
    await expect
      .poll(
        async () => {
          const fixes = await tsCodeFixes(page, fixApp, 1, 11, 1, 21);
          return fixes.some(
            (f) =>
              f.kind === 'quickfix' &&
              f.edits.length > 0 &&
              f.edits.some((e) => /localGreet/.test(e.text) && /\.\/greeter/.test(e.text)),
          );
        },
        { timeout: 30_000, intervals: [1500] },
      )
      .toBe(true);
    // The returned fix carries a NON-EMPTY edit (load-bearing: not a lying no-op fix).
    const fixes = await tsCodeFixes(page, fixApp, 1, 11, 1, 21);
    const addImport = fixes.find(
      (f) => f.kind === 'quickfix' && f.edits.some((e) => /import/.test(e.text)),
    );
    expect(addImport).toBeDefined();
    expect(addImport?.edits.length).toBeGreaterThan(0);
    expect(addImport?.edits.some((e) => e.uri.includes('app.ts'))).toBe(true);

    // (2) ORGANIZE-IMPORTS on organize.ts (unsorted + unused `VERSION`): the
    // source action returns a non-empty edit. The new import text sorts the names
    // and DROPS the unused `VERSION` (only `localGreet` survives) — the real
    // tsc organize, not a no-op.
    const organize = await tsOrganizeImports(page, organizeTs);
    expect(organize).not.toBeNull();
    expect(organize?.kind).toBe('source.organizeImports');
    expect(organize?.edits.length ?? 0).toBeGreaterThan(0);
    const organizeText = (organize?.edits ?? []).map((e) => e.text).join('');
    expect(organizeText).toContain('localGreet');
    expect(organizeText).not.toContain('VERSION');

    // (3) FORMAT-DOCUMENT on format.ts (bad spacing): the whole-document formatter
    // returns a non-empty edit set; APPLIED, the text restores spacing around the
    // operators / after commas (`a: number, b: number`, `a + b`, `const sum =`)
    // per tsserver defaults — the real formatter, not a pass-through.
    const formatResult = await tsFormat(page, formatTs);
    expect(formatResult).not.toBeNull();
    expect(formatResult?.editCount ?? 0).toBeGreaterThan(0);
    const formatted = formatResult?.applied ?? '';
    expect(formatted).toMatch(/a:\s*number,\s+b:\s*number/);
    expect(formatted).toMatch(/a\s+\+\s+b/);
    expect(formatted).toMatch(/sum\s*=/);
  });
});
