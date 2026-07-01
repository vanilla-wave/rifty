/**
 * ADR-0165 §4 switch coherence — the page surfaces (active root + active STARTER /
 * template) follow the page store across a launcher-driven transition, never a
 * stale signal. This is the second half of the store↔root single-source fix: a
 * starter pick spins a fresh scratch whose dev server re-boots at the active root,
 * and the chip / mode-hint reflect the store (not the prior preset). It also guards
 * the dev-boot shim re-root (the esbuild/rollup shim must overlay at the ACTIVE
 * root, not the historical `/workspace`, else native Rollup loads and Vite dies).
 *
 * The second describe below now exercises the FULL durable save→switch round-trip
 * (two SAVED projects, both trees intact across owner respawns) — the owner-side
 * `saveScratchAsProject` move landed (ADR-0165 §7). The editor program-mirror entry
 * path is now ROOT-RELATIVE too (ADR-0165 §4: `<root>/src/main.js`, not the legacy
 * `/workspace`), so node-server starters run their real server entry — covered by
 * owner-editor-write-exec-read.spec.ts (program edit → `<root>/src/main.js`) plus
 * fullstack-demo / socket-lab (the node-server presets boot end-to-end).
 */
import { type Page, expect, test } from '@playwright/test';
import { readWorkspaceJson, readWorkspaceText } from './helpers/opfs.ts';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  pickStarter as pickStarterFromLauncher,
  runTerminalLineSettled,
} from './helpers/playground.ts';

/** Terminal-session tabs only (editor tabs also use role=tab — scope to the shell). */
const TERMINAL_TAB = '.rf-terminal-tab__select[role="tab"]';
// Full-suite owner concurrency can delay the post-Save OPFS flush that starter
// picks now intentionally wait on, so use the same order of budget as durable
// tree polls instead of a UI-only 5s close budget.
const OWNER_DURABLE_TIMEOUT = 90_000;
const OPFS_POLL = OWNER_DURABLE_TIMEOUT;
type ProjectIndexSnapshot = {
  activeId: string;
  scratch: { starter: string; dirty: boolean } | null;
  projects: { id: string; name: string }[];
};

/**
 * Open a FRESH shell terminal and make it the active slot — robust to the running
 * tab count (the dev-server boot owns Terminal 1; a switch respawns + clears, so
 * the numbering is not stable across the round-trip). Waits for the new terminal
 * tab to appear rather than asserting a fixed "Terminal N".
 */
async function newShell(page: Page): Promise<void> {
  const before = await page.locator(TERMINAL_TAB).count();
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.locator(TERMINAL_TAB)).toHaveCount(before + 1, { timeout: 10_000 });
  // The newly-created tab is auto-selected (manager.select on create).
  await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

async function pickStarter(page: Page, id: string): Promise<void> {
  await pickStarterFromLauncher(page, id);
}

/** Open the launcher Projects tab via the top-bar chip. */
async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

/** Save the active scratch as a named project via the launcher Projects tab. */
async function saveScratchAs(page: Page, name: string): Promise<string> {
  await waitDurableScratch(page);
  await openProjects(page);
  await page.click('[data-action="save-scratch"]');
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  // Save closes the DIALOG but leaves the launcher open (the new project appears in
  // the Projects tab). Close the launcher explicitly so the editor regains focus.
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  const id = await projectIdForName(page, name);
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  return id;
}

/** Switch to a named project by clicking its durable project card. */
async function switchToProject(page: Page, name: string, id: string): Promise<void> {
  await openProjects(page);
  const card = page.locator(`.rf-pcard[data-project="${id}"]`, { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: OPFS_POLL });
  await card.click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: OWNER_DURABLE_TIMEOUT,
  });
}

async function expectProjectChipName(page: Page, name: string): Promise<void> {
  const chipName = page.locator('[data-action="open-launcher"] .rf-chip__name');
  await expect(chipName).toHaveText(name, { timeout: 15_000 });
  await expect(chipName).not.toHaveText('Untitled scratch');
  await expect(chipName).toHaveCSS('font-family', /JetBrains Mono/);
}

async function readProjectIndex(page: Page): Promise<ProjectIndexSnapshot | null> {
  return readWorkspaceJson<ProjectIndexSnapshot>(page, '/.rifty-project-index.json');
}

async function waitDurableScratch(page: Page, starter?: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const index = await readProjectIndex(page);
        return index?.activeId === 'scratch' &&
          index.scratch &&
          (starter === undefined || index.scratch.starter === starter)
          ? `${index.activeId}:${index.scratch.dirty ? 'dirty' : 'clean'}`
          : '';
      },
      { timeout: OPFS_POLL },
    )
    .toBe('scratch:clean');
}

/**
 * The on-disk project id the owner allocated for a saved project `name`. The Save's
 * OPFS write-through flush is async, so poll the durable index.
 */
async function projectIdForName(page: Page, name: string): Promise<string> {
  const readId = async (): Promise<string> => {
    const index = await readProjectIndex(page);
    return index?.projects.find((p) => p.name === name)?.id ?? '';
  };
  await expect.poll(readId, { timeout: OPFS_POLL }).not.toBe('');
  return readId();
}

/** Read `/projects/<id>/round-trip.txt` straight from OPFS (the durable on-disk tree). */
async function readProjectMarker(page: Page, id: string): Promise<string> {
  return await readWorkspaceText(page, `/projects/${id}/round-trip.txt`);
}

/** Poll until `/projects/<id>/round-trip.txt` holds `mark` (durable flush is async). */
async function expectProjectMarker(page: Page, id: string, mark: string): Promise<void> {
  await expect.poll(() => readProjectMarker(page, id), { timeout: OPFS_POLL }).toContain(mark);
}

test.describe('ADR-0165 §4 — switch coherence: surfaces follow the store', () => {
  test('a starter pick re-roots a fresh scratch and the dev server re-boots at the active root', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // A fresh load (no OPFS wipe — the wipe would discard the baked dependency
    // snapshot and force a Rollup native-binary install that fails under WASI).
    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Boot: active scratch, root = /scratch, the default Vite template's dev server
    // boots (proves the esbuild/rollup shim overlaid at /scratch, not /workspace).
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 15_000 });
    await expectProjectChipName(page, 'Project files scratch');
    await expectViteDevServerReady(page, 5174, 30_000);

    // Pick a DIFFERENT starter (node-worker — also the Vite template, instant
    // setup). The store spins a fresh scratch from that starter and the owner
    // re-boots its dev line. The root stays /scratch (still scratch-active) and the
    // surfaces follow the store, never the prior preset signal.
    await pickStarter(page, 'node-worker');
    await waitDurableScratch(page, 'node-worker');

    // Single source: every root-keyed surface still resolves from store.activeId.
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 15_000 });
    await expectProjectChipName(page, 'Node worker map scratch');

    // The dev server re-boots in the switched-in scratch (the restart path follows
    // the store-derived active starter/root, ADR-0165 §4 — not a frozen preset).
    await expectViteDevServerReady(page);
  });
});

/**
 * ADR-0165 §7 — the FULL durable round-trip: Save two scratches as named projects,
 * switch between them, and find each project's tree intact across the owner
 * respawn. This is the feature's core value: Save MOVES `/scratch` →
 * `/projects/<id>` on disk + persists the index (owner saveScratchAsProject +
 * write-through flush), so a switch respawns the owner at the saved project's real
 * tree (not an empty re-seed). FRONTEND starters only (node-server install is a
 * separate fix). Markers are written to the ABSOLUTE active root via the owner
 * shell (the persisted shell cwd is `/workspace`, NOT the active root — a relative
 * write would miss the scratch) and ASSERTED straight off OPFS at
 * `/projects/<id>/round-trip.txt` — the durable on-disk tree, never a UI mirror.
 *
 * RED-check: revert the owner index-save handler (`saveScratchAsProject` →
 * page-mirror-only) → Save no longer moves the tree → the project tree is empty →
 * `readProjectMarker` returns MISSING.
 */
test.describe('ADR-0165 §7 — durable Save + switch round-trip (two projects)', () => {
  test('two saved projects keep distinct trees across owner respawns', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // Unique names + markers per run: OPFS is per-origin and leaks across tests in
    // a worker, so two runs would collide on a project name. No OPFS wipe — the
    // wipe discards the baked dependency snapshot (a fresh-load Rollup install
    // fails under WASI; see the §4 test note) and resets the page to /workspace.
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alphaName = `Alpha-${tag}`;
    const betaName = `Beta-${tag}`;
    const alphaMark = `ALPHA-${tag}`;
    const betaMark = `BETA-${tag}`;

    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Boot lands on a fresh /scratch (project-files starter). Write Alpha's marker
    // into the scratch (ABSOLUTE path = the active root) via a shell terminal, then
    // Save it as a project (owner moves /scratch → /projects/<id>, durable).
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 30_000 });
    await waitDurableScratch(page);
    await newShell(page);
    await runTerminalLineSettled(page, `echo ${alphaMark} > /scratch/round-trip.txt`);
    await runTerminalLineSettled(page, 'cat /scratch/round-trip.txt');
    await expectTerminalContains(page, alphaMark, 15_000);
    const alphaId = await saveScratchAs(page, alphaName);
    expect(alphaId).not.toBe('');

    // Pick a DIFFERENT frontend starter for a fresh scratch, write Beta's marker,
    // and Save it too. (node-worker shares the vite template; no node-server install.)
    await pickStarter(page, 'node-worker');
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 30_000 });
    await waitDurableScratch(page, 'node-worker');
    await newShell(page);
    await runTerminalLineSettled(page, `echo ${betaMark} > /scratch/round-trip.txt`);
    await runTerminalLineSettled(page, 'cat /scratch/round-trip.txt');
    await expectTerminalContains(page, betaMark, 15_000);
    const betaId = await saveScratchAs(page, betaName);
    expect(betaId).not.toBe('');
    expect(betaId).not.toBe(alphaId);

    // Both trees moved to their own /projects/<id> on disk, each with ITS marker —
    // distinct, intact, durable in OPFS (the feature's core contract). Poll: the
    // Save's write-through flush is async in the owner.
    await expectProjectMarker(page, alphaId, alphaMark);
    expect(await readProjectMarker(page, alphaId)).not.toContain(betaMark);
    await expectProjectMarker(page, betaId, betaMark);
    expect(await readProjectMarker(page, betaId)).not.toContain(alphaMark);

    // Switch to Alpha: the owner tears down + respawns at /projects/<alphaId>. The
    // tree survives the respawn — re-read it from OPFS while Alpha is the live owner.
    await switchToProject(page, alphaName, alphaId);
    await expect(hint).toContainText(`Commands run in /projects/${alphaId};`, { timeout: 60_000 });
    await expectProjectChipName(page, alphaName);
    await expectProjectMarker(page, alphaId, alphaMark);

    // Switch to Beta: its distinct tree is intact too across the second respawn.
    await switchToProject(page, betaName, betaId);
    await expect(hint).toContainText(`Commands run in /projects/${betaId};`, { timeout: 60_000 });
    await expectProjectChipName(page, betaName);
    await expectProjectMarker(page, betaId, betaMark);
    expect(await readProjectMarker(page, betaId)).not.toContain(alphaMark);
  });
});
