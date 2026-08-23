import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

const COMPLETION_FAULT_CONTROL = '__riftyCompletionFaultControl';

async function installCompletionBoundaryFault(page: Page): Promise<void> {
  await page.addInitScript((controlKey) => {
    type HeldPostMessage = {
      readonly receiver: MessagePort;
      readonly args: readonly unknown[];
      readonly sid: unknown;
      readonly opId: unknown;
    };

    function findFrame(
      value: unknown,
      type: string,
      seen = new Set<object>(),
    ): Record<string, unknown> | null {
      if (typeof value !== 'object' || value === null || seen.has(value)) return null;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const nested of value) {
          const found = findFrame(nested, type, seen);
          if (found !== null) return found;
        }
        return null;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const record = value as Record<string, unknown>;
      if (record.type === type) return record;
      for (const nested of Object.values(record)) {
        const found = findFrame(nested, type, seen);
        if (found !== null) return found;
      }
      return null;
    }

    const postMessageDescriptor = Object.getOwnPropertyDescriptor(
      MessagePort.prototype,
      'postMessage',
    );
    const onMessageDescriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
    if (
      postMessageDescriptor === undefined ||
      typeof postMessageDescriptor.value !== 'function' ||
      onMessageDescriptor === undefined ||
      typeof onMessageDescriptor.set !== 'function'
    ) {
      throw new Error('MessagePort completion fault boundary is unavailable');
    }

    const originalPostMessage = postMessageDescriptor.value;
    const originalOnMessageSetter = onMessageDescriptor.set;
    let held: HeldPostMessage | null = null;
    let phase: 'waiting' | 'held' | 'released' | 'received' = 'waiting';
    let restored = false;

    const patchedPostMessage = function (this: MessagePort, ...args: unknown[]): void {
      const request = findFrame(args[0], 'pty:complete');
      if (phase === 'waiting' && request !== null) {
        held = {
          receiver: this,
          args,
          sid: request.sid,
          opId: request.opId,
        };
        phase = 'held';
        return;
      }
      Reflect.apply(originalPostMessage, this, args);
    };

    Object.defineProperty(MessagePort.prototype, 'postMessage', {
      ...postMessageDescriptor,
      value: patchedPostMessage,
    });
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      ...onMessageDescriptor,
      set(this: MessagePort, handler: unknown) {
        if (typeof handler !== 'function') {
          Reflect.apply(originalOnMessageSetter, this, [handler]);
          return;
        }
        const wrapped = function (this: MessagePort, event: MessageEvent): unknown {
          const result = findFrame(event.data, 'pty:complete-result');
          if (
            result !== null &&
            held !== null &&
            result.sid === held.sid &&
            result.opId === held.opId
          ) {
            phase = 'received';
          }
          return Reflect.apply(handler, this, [event]);
        };
        Reflect.apply(originalOnMessageSetter, this, [wrapped]);
      },
    });

    Reflect.set(
      globalThis,
      controlKey,
      Object.freeze({
        get phase() {
          return phase;
        },
        release(): void {
          if (held === null || phase !== 'held') {
            throw new Error(`No held pty:complete request to release (phase=${phase})`);
          }
          phase = 'released';
          Reflect.apply(originalPostMessage, held.receiver, held.args);
        },
        restore(): void {
          if (restored) return;
          restored = true;
          Object.defineProperty(MessagePort.prototype, 'postMessage', postMessageDescriptor);
          Object.defineProperty(MessagePort.prototype, 'onmessage', onMessageDescriptor);
          Reflect.deleteProperty(globalThis, controlKey);
        },
      }),
    );
  }, COMPLETION_FAULT_CONTROL);
}

async function completionFaultPhase(page: Page): Promise<string> {
  return page.evaluate((controlKey) => {
    const control = Reflect.get(globalThis, controlKey);
    if (typeof control !== 'object' || control === null) return 'missing';
    return String(Reflect.get(control, 'phase'));
  }, COMPLETION_FAULT_CONTROL);
}

async function releaseHeldCompletion(page: Page): Promise<void> {
  await page.evaluate((controlKey) => {
    const control = Reflect.get(globalThis, controlKey);
    if (typeof control !== 'object' || control === null) {
      throw new Error('Completion fault control is missing');
    }
    const release = Reflect.get(control, 'release');
    if (typeof release !== 'function') throw new Error('Completion release hook is missing');
    Reflect.apply(release, control, []);
  }, COMPLETION_FAULT_CONTROL);
}

async function restoreCompletionBoundary(page: Page): Promise<void> {
  await page.evaluate((controlKey) => {
    const control = Reflect.get(globalThis, controlKey);
    if (typeof control !== 'object' || control === null) return;
    const restore = Reflect.get(control, 'restore');
    if (typeof restore !== 'function') throw new Error('Completion restore hook is missing');
    Reflect.apply(restore, control, []);
  }, COMPLETION_FAULT_CONTROL);
}

function kernelProcessManagerSourceUrl(): string {
  const root = process.cwd();
  if (!root.startsWith('/'))
    throw new Error(`Expected an absolute workspace root, received ${root}`);
  const path = `${root.slice(1)}/packages/kernel/src/process-manager.ts`;
  return `/@fs/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function killPageWorkbenchOwner(page: Page): Promise<void> {
  const killedPid = await page.evaluate(async (moduleUrl) => {
    const kernelModule: unknown = await import(moduleUrl);
    if (typeof kernelModule !== 'object' || kernelModule === null) {
      throw new Error('Kernel process-manager module did not load');
    }
    const manager = Reflect.get(kernelModule, 'globalProcessManager');
    if (typeof manager !== 'object' || manager === null) {
      throw new Error('Kernel globalProcessManager is missing');
    }
    const snapshotMethod = Reflect.get(manager, 'snapshot');
    const killMethod = Reflect.get(manager, 'kill');
    if (typeof snapshotMethod !== 'function' || typeof killMethod !== 'function') {
      throw new Error('Kernel process-manager methods are missing');
    }
    const snapshot: unknown = Reflect.apply(snapshotMethod, manager, []);
    if (!Array.isArray(snapshot)) throw new Error('Kernel process snapshot is malformed');
    const owner = snapshot.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        Reflect.get(entry, 'command') === 'workbench-owner',
    );
    if (owner === undefined) throw new Error('Page-side workbench-owner process is missing');
    const pid = Reflect.get(owner, 'pid');
    if (typeof pid !== 'number') throw new Error('Page-side workbench-owner PID is malformed');
    if (Reflect.apply(killMethod, manager, [pid, 'SIGTERM']) !== true) {
      throw new Error(`Page-side workbench-owner ${String(pid)} refused SIGTERM`);
    }
    return pid;
  }, kernelProcessManagerSourceUrl());
  expect(killedPid).toBeGreaterThan(1);
}

test('owner-backed completion discovers installed and direct commands, then runs the selection', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(180_000);

  await bootProjectFiles(page);
  await expectViteDevServerReady(page, 5174, 90_000);
  await openShellTerminal(page);

  // Seed through the public terminal so the next completion must observe the
  // live owner VFS; the instant preset already supplies installed Vite.
  await runTerminalLineSettled(page, 'mkdir -p scripts');
  await runTerminalLineSettled(
    page,
    `echo 'console.log("DIRECT_COMPLETION:" + process.argv.slice(2).join(",")); process.exitCode = process.argv[2] === "selected" ? 0 : 9;' > scripts/tool.mjs`,
  );

  const activeSlot = page.locator('.rf-terminal-slot[data-active="true"]');
  const terminal = activeSlot.locator('[data-testid="terminal"]');
  await terminal.click();

  await page.keyboard.insertText('vit');
  await page.keyboard.press('Tab');
  const menu = activeSlot.locator('.rf-terminal-autocomplete');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu.getByRole('button', { name: 'vite', exact: true })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Control+u');

  await page.keyboard.insertText('./scripts/to');
  await page.keyboard.press('Tab');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu.getByRole('button', { name: 'tool.mjs', exact: true })).toHaveCount(1);

  // Tab chooses the active DOM-menu entry. Supplying an argument and Enter then
  // exercises that exact completed direct path, rather than a separately typed
  // approximation of it.
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await page.keyboard.insertText('selected');
  await page.keyboard.press('Enter');

  const directCommand = './scripts/tool.mjs selected';
  await expectTerminalContains(page, 'DIRECT_COMPLETION:selected', 30_000);
  await expect(page.locator('.rf-terminal-tab[data-active="true"]')).toHaveAttribute(
    'data-running',
    'false',
    { timeout: 30_000 },
  );
  await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/>\s*$/u);
  expect(await terminalHistoryExitCode(page, directCommand)).toBe(0);
});

test('an edit superseding an inflight owner completion drops its late menu', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(180_000);
  await installCompletionBoundaryFault(page);

  try {
    await bootProjectFiles(page);
    await expectViteDevServerReady(page, 5174, 90_000);
    await openShellTerminal(page);

    const activeSlot = page.locator('.rf-terminal-slot[data-active="true"]');
    const menu = activeSlot.locator('.rf-terminal-autocomplete');
    await activeSlot.locator('[data-testid="terminal"]').click();
    await page.keyboard.insertText('vit');
    await page.keyboard.press('Tab');
    await expect.poll(() => completionFaultPhase(page), { timeout: 15_000 }).toBe('held');

    await page.keyboard.insertText('e');
    await expect.poll(() => terminalBuffer(page), { timeout: 5_000 }).toMatch(/>\s*vite\s*$/u);
    await releaseHeldCompletion(page);
    await expect.poll(() => completionFaultPhase(page), { timeout: 15_000 }).toBe('received');
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    await expect(menu).toHaveCount(0);
  } finally {
    await restoreCompletionBoundary(page);
  }
});

test('owner death during completion reports a product error and leaves no menu', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(180_000);
  await installCompletionBoundaryFault(page);

  try {
    await bootProjectFiles(page);
    await expectViteDevServerReady(page, 5174, 90_000);
    await openShellTerminal(page);

    const activeSlot = page.locator('.rf-terminal-slot[data-active="true"]');
    const menu = activeSlot.locator('.rf-terminal-autocomplete');
    await activeSlot.locator('[data-testid="terminal"]').click();
    await page.keyboard.insertText('vit');
    await page.keyboard.press('Tab');
    await expect.poll(() => completionFaultPhase(page), { timeout: 15_000 }).toBe('held');

    await killPageWorkbenchOwner(page);

    const errorToast = page.locator('.rf-toast[data-tone="error"]');
    await expect(errorToast).toContainText(
      /Completion failed: Workbench owner exited unexpectedly \(code (?:null|\d+), signal (?:SIGTERM|null)\)/u,
      { timeout: 15_000 },
    );
    await expect(menu).toHaveCount(0);
  } finally {
    await restoreCompletionBoundary(page);
  }
});
