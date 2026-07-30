import { type Locator, type Page, expect } from '@playwright/test';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function stripTerminal(text: string): string {
  return text.replace(ANSI_SGR, '');
}

export interface TerminalSessionTarget {
  readonly sessionId: string;
}

export type TerminalTarget = 'active' | number | TerminalSessionTarget;

async function waitForWorkspaceOwner(page: Page): Promise<void> {
  await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
    timeout: 90_000,
  });
}

async function waitForProjectIndex(page: Page): Promise<void> {
  await expect(page.locator('.rf-app[data-project-index="ready"]')).toBeVisible({
    timeout: 90_000,
  });
}

async function terminalSlot(page: Page, slot: TerminalTarget): Promise<Locator> {
  if (slot === 'active') return page.locator('.rf-terminal-slot[data-active="true"]');
  if (typeof slot === 'number') return page.locator('.rf-terminal-slot').nth(slot);
  return page.locator(`.rf-terminal-slot[data-session-id="${slot.sessionId}"]`);
}

function terminalTab(page: Page, target: number | TerminalSessionTarget): Locator {
  const tabs = page.locator('.rf-terminal-tab__select[role="tab"][data-session-id]');
  return typeof target === 'number'
    ? tabs.nth(target)
    : page.locator(`.rf-terminal-tab__select[role="tab"][data-session-id="${target.sessionId}"]`);
}

export async function terminalBuffer(page: Page, slot: TerminalTarget = 'active'): Promise<string> {
  const locator = (await terminalSlot(page, slot)).locator('[data-testid="terminal-buffer"]');
  return stripTerminal((await locator.getAttribute('data-terminal-buffer')) ?? '');
}

export async function openShellTerminal(
  page: Page,
  options: { readonly focus?: boolean } = {},
): Promise<TerminalSessionTarget> {
  const focus = options.focus ?? true;
  if (
    await page
      .locator('[data-testid="launcher"]')
      .isVisible({ timeout: 0 })
      .catch(() => false)
  ) {
    await openActiveProjectFromLauncher(page);
  }
  await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
  await expect(page.locator('.rf-terminal-tab__select[role="tab"]').first()).toBeVisible();
  await expect(page.locator('.rf-terminal-slot').first()).toBeAttached();
  const terminalSlots = page.locator('.rf-terminal-slot');
  const slotCountBefore = await terminalSlots.count();
  const slotIdsBefore = await terminalSlots.evaluateAll((slots) =>
    slots.map((slot) => slot.getAttribute('data-session-id')).filter((id) => id != null),
  );
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect
    .poll(() => terminalSlots.count(), { timeout: 10_000 })
    .toBeGreaterThan(slotCountBefore);
  const newSessionId = async () =>
    terminalSlots.evaluateAll(
      (slots, before) =>
        slots
          .map((slot) => slot.getAttribute('data-session-id'))
          .find((id): id is string => id != null && !before.includes(id)) ?? '',
      slotIdsBefore,
    );
  await expect.poll(newSessionId, { timeout: 10_000 }).not.toBe('');
  const sessionId = await newSessionId();
  if (sessionId.length === 0) throw new Error('new terminal did not expose a session id');
  const tab = page.locator(`.rf-terminal-tab__select[data-session-id="${sessionId}"]`);
  await expect(tab).toBeVisible();
  if (focus) await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const slot = page.locator(`.rf-terminal-slot[data-session-id="${sessionId}"]`);
  await expect(slot).toHaveAttribute('data-active', 'true');
  const target = Object.freeze({ sessionId });
  await expect.poll(() => terminalBuffer(page, target), { timeout: 30_000 }).toMatch(/>\s*$/u);
  if (!focus) return target;
  await slot.locator('[data-testid="terminal"]').click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const terminal = document.querySelector('[data-testid="terminal"]');
          const active = document.activeElement;
          return terminal != null && active != null && terminal.contains(active);
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  return target;
}

export async function pickStarter(page: Page, id = 'project-files'): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  if (!(await launcher.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await page.click('[data-action="open-launcher"]', { timeout: 2_000 }).catch(async (err) => {
      if (!(await launcher.isVisible({ timeout: 0 }).catch(() => false))) throw err;
    });
  }
  await expect(launcher).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Starters', exact: true }).click();
  await page.click(`[data-preset="${id}"]`);

  const discard = page.getByRole('button', { name: 'Discard & continue', exact: true });
  if (await discard.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await discard.click();
  }

  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="launcher"]') === null ||
      document.querySelector('.rf-toast[data-tone="error"]') !== null,
    undefined,
    { timeout: 90_000 },
  );
  const errorToast = page.locator('.rf-toast[data-tone="error"]');
  const transitionError = (await errorToast.count()) === 0 ? null : await errorToast.textContent();
  if (transitionError !== null) throw new Error(`Starter transition failed: ${transitionError}`);
  await expect(launcher).toHaveCount(0, { timeout: 90_000 });
  await waitForWorkspaceOwner(page);
}

export async function openActiveProjectFromLauncher(page: Page): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 5_000 });
  await waitForProjectIndex(page);
  await page.getByRole('button', { name: /^Projects/ }).click();

  const scratchOpen = launcher.locator('.rf-scratch').getByRole('button', {
    name: /^(Open|Switch to)$/,
  });
  if (await scratchOpen.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(scratchOpen).toBeEnabled({ timeout: 90_000 });
    await scratchOpen.click();
    await expect(launcher).toHaveCount(0, { timeout: 90_000 });
    await waitForWorkspaceOwner(page);
    return;
  }

  const activeProject = launcher.locator('.rf-pcard[data-active="true"]').first();
  if (await activeProject.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(activeProject).toHaveAttribute('role', 'button', { timeout: 90_000 });
    await activeProject.click();
    await expect(launcher).toHaveCount(0, { timeout: 90_000 });
    await waitForWorkspaceOwner(page);
    return;
  }

  await pickStarter(page, 'project-files');
}

export async function closeLauncherIfOpen(page: Page, timeout = 1_000): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  if (!(await launcher.isVisible({ timeout }).catch(() => false))) return;
  await page.locator('.rf-launcher__close').click();
  await expect(launcher).toHaveCount(0, { timeout: 5_000 });
}

export async function bootStarter(page: Page, id = 'project-files'): Promise<void> {
  await page.goto('/');
  await pickStarter(page, id);
}

export async function bootProjectFiles(page: Page): Promise<void> {
  await bootStarter(page, 'project-files');
}

export async function bootShell(page: Page): Promise<void> {
  await bootProjectFiles(page);
}

export async function resetSandboxThroughUi(page: Page): Promise<void> {
  await page.goto('/');
  const launcher = page.locator('[data-testid="launcher"]');
  if (!(await launcher.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const trigger = page.locator('[data-action="open-launcher"]');
    await expect(trigger).toBeEnabled({ timeout: 90_000 });
    await trigger.click({ force: true });
  }
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.getByRole('button', { name: /^Projects/ }).click();
  await launcher.getByRole('button', { name: 'Reset sandbox' }).click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toContainText('Reset browser sandbox?');
  await Promise.all([
    page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 90_000,
    }),
    dialog.getByRole('button', { name: 'Reset sandbox' }).click(),
  ]);
}

export async function runTerminalLine(
  page: Page,
  line: string,
  targetSlot: TerminalTarget = 'active',
): Promise<void> {
  await closeLauncherIfOpen(page, 0);
  if (targetSlot !== 'active') {
    const tab = terminalTab(page, targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot = await terminalSlot(page, targetSlot);
  await expect(slot).toBeVisible();
  await expect.poll(() => terminalBuffer(page, targetSlot), { timeout: 30_000 }).toMatch(/>\s*$/u);
  await slot.locator('[data-testid="terminal"]').click();
  const input = slot.locator('textarea.xterm-helper-textarea, textarea').first();
  await expect(input).toBeAttached();
  await input.focus();
  await expect
    .poll(() => input.evaluate((el) => document.activeElement === el), { timeout: 5_000 })
    .toBe(true);
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
}

function terminalPromptCount(text: string): number {
  return text.match(/(?:^|\n)> /gu)?.length ?? 0;
}

async function activeTerminalRunning(page: Page): Promise<boolean> {
  return (
    (await page.locator('.rf-terminal-tab[data-active="true"]').getAttribute('data-running')) ===
    'true'
  );
}

async function waitForActiveTerminalIdle(page: Page, timeout = 30_000): Promise<void> {
  await expect.poll(() => activeTerminalRunning(page), { timeout }).toBe(false);
}

export async function runTerminalLineSettled(
  page: Page,
  line: string,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(async () => terminalPromptCount(await terminalBuffer(page)), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await waitForActiveTerminalIdle(page);
  const before = await terminalBuffer(page);
  await runTerminalLine(page, line);
  const submittedAt = Date.now();
  let observedActivity = false;
  await expect
    .poll(
      async () => {
        const buffer = await terminalBuffer(page);
        const running = await activeTerminalRunning(page);
        observedActivity =
          observedActivity || running || buffer !== before || Date.now() - submittedAt > 250;
        return observedActivity && !running && />\s*$/u.test(buffer);
      },
      { timeout },
    )
    .toBe(true);
}

const EXACT_TERMINAL_HISTORY_EXIT_CODE = /^(?:0|[1-9]\d*)$/u;

/** Decode only the terminal history's canonical nonnegative safe-integer encoding. */
export function decodeTerminalHistoryExitCode(
  raw: string | null | undefined,
  line: string,
): number {
  if (raw === null || raw === undefined || !EXACT_TERMINAL_HISTORY_EXIT_CODE.test(raw)) {
    throw new Error(`terminal history has no exact exit code for ${line}: ${String(raw)}`);
  }
  const code = Number(raw);
  if (!Number.isSafeInteger(code)) {
    throw new Error(`terminal history has no exact exit code for ${line}: ${raw}`);
  }
  return code;
}

/** Exact exit status recorded by the real terminal run, read through its history UI. */
export async function terminalHistoryExitCode(
  page: Page,
  line: string,
  targetSlot: TerminalTarget = 'active',
): Promise<number> {
  if (targetSlot !== 'active') {
    const tab = terminalTab(page, targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot = await terminalSlot(page, targetSlot);
  await slot.locator('[data-testid="terminal"]').click();
  await page.keyboard.press('Control+r');
  const history = slot.locator('.rf-terminal-history');
  await expect(history).toBeVisible();
  await history.locator('.rf-terminal-history__input').fill(line);
  const items = history.locator('.rf-terminal-history__item');
  await expect(items.first()).toBeVisible();
  await expect(items.first().locator('.rf-terminal-history__cmd')).toHaveText(line);
  const raw = await items.first().getAttribute('data-exit');
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
  return decodeTerminalHistoryExitCode(raw, line);
}

export interface ActiveProjectText {
  readonly exists: boolean;
  readonly text: string;
}

let activeProjectReadSequence = 0;

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function readActiveProjectText(
  page: Page,
  path: string,
  timeout = 30_000,
): Promise<ActiveProjectText> {
  const sequence = ++activeProjectReadSequence;
  const marker = `__rifty_project_read_${String(Date.now())}_${String(sequence)}__`;
  const begin = `${marker}begin`;
  const missing = `${marker}missing`;
  const end = `${marker}end`;
  await runTerminalLineSettled(
    page,
    `printf '${begin}\\n'; cat ${shellWord(path)} || printf '\\n${missing}\\n'; printf '${end}\\n'`,
    timeout,
  );
  const buffer = await terminalBuffer(page);
  const start = buffer.lastIndexOf(begin);
  const finish = start < 0 ? -1 : buffer.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) throw new Error(`Project read markers missing for ${path}`);
  const payload = buffer
    .slice(start + begin.length, finish)
    .replace(/^\r?\n/u, '')
    .replace(/\r?\n$/u, '');
  if (!payload.includes(missing)) return Object.freeze({ exists: true, text: payload });
  const diagnostic = payload.slice(0, payload.indexOf(missing)).trim();
  if (!/cat: .*: No such file or directory$/u.test(diagnostic)) {
    throw new Error(`Project read failed for ${path}: ${diagnostic || 'unknown cat error'}`);
  }
  return Object.freeze({ exists: false, text: '' });
}

export async function insertTerminalLineSettled(
  page: Page,
  line: string,
  timeout = 30_000,
  targetSlot: TerminalTarget = 'active',
): Promise<void> {
  const before = terminalPromptCount(await terminalBuffer(page, targetSlot));
  if (targetSlot !== 'active') {
    const tab = terminalTab(page, targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot = await terminalSlot(page, targetSlot);
  await expect(slot).toBeVisible();
  await expect.poll(() => terminalBuffer(page, targetSlot), { timeout: 30_000 }).toMatch(/>\s*$/u);
  await slot.locator('[data-testid="terminal"]').click();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => terminalPromptCount(await terminalBuffer(page, targetSlot)), { timeout })
    .toBeGreaterThan(before);
}

export async function expectTerminalContains(
  page: Page,
  text: string | RegExp,
  timeout = 5_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page), { timeout }).toMatch(terminalPattern(text));
}

// `viteDevReadyPattern` (the rifty-authored `[vite] dev server ready` marker) is
// GONE — the runtime no longer prints it (generic dev-server lifecycle); wait on
// the LIVE pill via expectViteDevServerReady instead.
export type InitialTerminalState = 'vite-booted' | 'idle-shell';

export async function waitForViteBootOrIdleShell(
  page: Page,
  opts: { readonly viteTimeout?: number; readonly promptTimeout?: number } = {},
): Promise<InitialTerminalState> {
  try {
    await expect
      .poll(() => terminalBuffer(page), { timeout: opts.viteTimeout ?? 60_000 })
      .toMatch(/\$ vite/u);
    return 'vite-booted';
  } catch {
    await expect
      .poll(() => terminalBuffer(page), { timeout: opts.promptTimeout ?? 10_000 })
      .toMatch(/>\s*$/u);
    return 'idle-shell';
  }
}

export interface CapturedPageProblems {
  readonly messages: readonly string[];
  assertNoViteImportErrors(): void;
}

export function capturePageProblems(page: Page): CapturedPageProblems {
  const messages: string[] = [];
  page.on('pageerror', (err) => {
    messages.push(`[pageerror] ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') messages.push(`[console.error] ${msg.text()}`);
  });
  return {
    messages,
    assertNoViteImportErrors(): void {
      expect(messages.join('\n')).not.toMatch(
        /(?:Pre-transform error|vite:import-analysis|Failed to resolve import)/u,
      );
    },
  };
}

function terminalPattern(text: string | RegExp): string | RegExp {
  return text;
}

export async function selectPreset(page: Page, id: string): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  const trigger = page.locator('[data-action="open-launcher"]');
  // The project-first chooser auto-opens on cold boot. Open it ourselves only
  // when that did not happen.
  if (!(await launcher.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await expect(trigger).toBeEnabled({ timeout: 90_000 });
    // The auto-open may win after the visibility sample; force keeps this
    // idempotent open intent from hanging behind the launcher's own veil.
    await trigger.click({ force: true });
  }
  await expect(launcher).toBeVisible({ timeout: 10_000 });
  const row = page.locator(`[data-preset="${id}"]`);
  if (!(await row.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Starters' }).click();
  }
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toBeEnabled({ timeout: 90_000 });
  await row.click();

  const discard = page.getByRole('button', { name: 'Discard & continue' });
  if (await discard.isVisible().catch(() => false)) await discard.click();

  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="launcher"]') === null ||
      document.querySelector('.rf-toast[data-tone="error"]') !== null,
    undefined,
    { timeout: 150_000 },
  );
  const errorToast = page.locator('.rf-toast[data-tone="error"]');
  const transitionError = (await errorToast.count()) === 0 ? null : await errorToast.textContent();
  if (transitionError !== null) throw new Error(`Preset transition failed: ${transitionError}`);
  await expect(launcher).toHaveCount(0);
}

/**
 * Wait until the dev server on `port` is UP per the UI — never a rifty-authored
 * terminal marker (the terminal carries only tool output; backlog:
 * playground/generic-dev-server-lifecycle). Readiness signals, any of:
 *  - the LIVE pill derived from the listening-port set (`LIVE :<port>`),
 *  - the preview switcher listing `:<port>` (a non-primary second server),
 *  - the tool's OWN output (`VITE vN ready` / `localhost:<port>`).
 */
export async function expectViteDevServerReady(
  page: Page,
  port = 5174,
  timeout = 60_000,
  slot: TerminalTarget = 'active',
): Promise<void> {
  const ready = new RegExp(
    `VITE v\\d+(?:\\.\\d+){0,2}\\s+ready|localhost:${port}|\\[status\\] UP :${port}`,
    'u',
  );
  const pill = page.locator('.rf-livepill[data-state="running"]', {
    hasText: `LIVE :${port}`,
  });
  const switcherOption = page.locator('.rf-preview__switcher option', {
    hasText: `:${port}`,
  });
  await expect
    .poll(
      async () => {
        const buffer = await terminalBuffer(page, slot);
        const live =
          (await pill.isVisible({ timeout: 250 }).catch(() => false)) ||
          (await switcherOption.count().catch(() => 0)) > 0;
        return live ? `${buffer}\n[status] UP :${port}` : buffer;
      },
      { timeout },
    )
    .toMatch(ready);
}
