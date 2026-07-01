import { type Page, expect } from '@playwright/test';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function stripTerminal(text: string): string {
  return text.replace(ANSI_SGR, '');
}

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

export async function terminalBuffer(
  page: Page,
  slot: 'active' | number = 'active',
): Promise<string> {
  const locator =
    slot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal-buffer"]')
      : page.locator('.rf-terminal-slot').nth(slot).locator('[data-testid="terminal-buffer"]');
  return stripTerminal((await locator.getAttribute('data-terminal-buffer')) ?? '');
}

export async function openShellTerminal(
  page: Page,
  options: { readonly focus?: boolean } = {},
): Promise<number> {
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
  await expect(page.getByRole('tab', { name: /Terminal \d+/ }).first()).toBeVisible();
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
  const slotIndex = await terminalSlots.evaluateAll(
    (slots, id) => slots.findIndex((slot) => slot.getAttribute('data-session-id') === id),
    sessionId,
  );
  if (slotIndex < 0) throw new Error('new terminal did not activate a terminal slot');
  await expect.poll(() => terminalBuffer(page, slotIndex), { timeout: 30_000 }).toMatch(/>\s*$/u);
  if (!focus) return slotIndex;
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
  return slotIndex;
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
    await scratchOpen.click();
    await expect(launcher).toHaveCount(0, { timeout: 90_000 });
    await waitForWorkspaceOwner(page);
    return;
  }

  const activeProject = launcher.locator('.rf-pcard[data-active="true"]').first();
  if (await activeProject.isVisible({ timeout: 5_000 }).catch(() => false)) {
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

export async function runTerminalLine(
  page: Page,
  line: string,
  targetSlot: 'active' | number = 'active',
): Promise<void> {
  await closeLauncherIfOpen(page, 0);
  if (targetSlot !== 'active') {
    const tab = page.getByRole('tab', { name: /Terminal \d+/ }).nth(targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot =
    targetSlot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"]')
      : page.locator('.rf-terminal-slot').nth(targetSlot);
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

export async function insertTerminalLineSettled(
  page: Page,
  line: string,
  timeout = 30_000,
  targetSlot: 'active' | number = 'active',
): Promise<void> {
  const before = terminalPromptCount(await terminalBuffer(page, targetSlot));
  if (targetSlot !== 'active') {
    const tab = page.getByRole('tab', { name: /Terminal \d+/ }).nth(targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot =
    targetSlot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"]')
      : page.locator('.rf-terminal-slot').nth(targetSlot);
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

export function viteDevReadyPattern(port = 5174): RegExp {
  return new RegExp(`\\[vite\\] dev server ready on port ${port}`, 'u');
}

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
  if (typeof text !== 'string') return text;
  const match = /^\[vite\] dev server ready on port (\d+)$/u.exec(text);
  return match ? viteDevReadyPattern(Number(match[1])) : text;
}

export async function selectPreset(page: Page, id: string): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  const trigger = page.locator('[data-action="open-launcher"]');
  for (let attempt = 0; attempt < 5; attempt++) {
    // The project-first chooser AUTO-opens on cold boot (~1s) and its veil would
    // intercept a header-trigger click. Wait past that beat (>1s) so a cold boot
    // always finds the auto-chooser; only open it ourselves — force, so no veil can
    // block it since it's only closed mid-session — if it stayed shut.
    if (!(await launcher.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await trigger.click({ force: true }).catch(() => {});
    }
    await expect(launcher).toBeVisible({ timeout: 10_000 });
    const row = page.locator(`[data-preset="${id}"]`);
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Starters' }).click();
    }
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click({ force: true });
    try {
      await expect(page.locator('[data-testid="launcher"]')).toBeHidden({ timeout: 1_000 });
      return;
    } catch {
      await page.waitForTimeout(100);
    }
  }
  await expect(page.locator('[data-testid="launcher"]')).toBeHidden({ timeout: 5_000 });
}

export async function expectViteDevServerReady(
  page: Page,
  port = 5174,
  timeout = 60_000,
  slot: 'active' | number = 'active',
): Promise<void> {
  const ready = new RegExp(
    `\\[vite\\] dev server ready on port ${port}|VITE v\\d+(?:\\.\\d+){0,2}\\s+ready|localhost:${port}|\\[status\\] LIVE :${port}`,
    'u',
  );
  await expect
    .poll(
      async () => {
        const buffer = await terminalBuffer(page, slot);
        const live = await page
          .getByText(`LIVE :${port}`, { exact: true })
          .isVisible({ timeout: 250 })
          .catch(() => false);
        return live ? `${buffer}\n[status] LIVE :${port}` : buffer;
      },
      { timeout },
    )
    .toMatch(ready);
}
