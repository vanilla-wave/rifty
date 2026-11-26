import { type Page, expect, test } from '@playwright/test';
import { attemptBootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const messagePortRefUrl = `/@fs${workspacePath}/packages/runtime-js/src/internal/message-port-ref.ts`;
import {
  type MessagePortRefCase,
  portRows,
  refcountIsolationCase,
  runNodeOracle,
  runOwnerCommand,
  transferCeilingCase,
  transferCeilingRows,
} from './fixtures/message-port-ref-cases.ts';

async function runInOwner(
  page: Page,
  fixture: MessagePortRefCase,
  deadlineMs: number,
): Promise<{ readonly timedOut: boolean; readonly exit: number | null; readonly out: string }> {
  await gotoHarness(page);
  // Every nested cause: an owner realm that dies at install names its own error.
  const boot = await attemptBootOwner(page, {
    workspaceId: `bu-port-ref-${fixture.name}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  expect(boot).toEqual({ ok: true, messages: [] });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/main.cjs', fixture.source);
    return await runOwnerCommand(page, 'node main.cjs', deadlineMs);
  } finally {
    await closeOwner(page);
  }
}

// Fault class: torn-state. Redundant ref/unref/close calls on one port never add
// a second hold and never release another handle's hold (ADR-0447 fault row 1).
test('one port contributes exactly zero or one keepalive hold', async ({ page }) => {
  const oracle = await runNodeOracle(refcountIsolationCase.source);
  expect(oracle.code, oracle.stderr).toBe(0);
  const run = await runInOwner(page, refcountIsolationCase, 10_000);
  expect(run.timedOut, run.out).toBe(false);
  expect(portRows(run.out), run.out).toEqual(portRows(oracle.stdout));
  expect(run.exit, run.out).toBe(oracle.code);
});

// Fault class: provenance-lie. After a transfer, the release is not observable,
// so it is refused before anything detaches, at every entry point. A referenced
// port keeps its peer and keeps holding the program (ADR-0447 fault rows 2-3).
test('transfers that would hide a referenced port release fail by name', async ({ page }) => {
  const run = await runInOwner(page, transferCeilingCase, 10_000);
  expect(run.timedOut, run.out).toBe(false);
  expect(portRows(run.out), run.out).toEqual(transferCeilingRows);
  expect(run.exit, run.out).toBe(0);
});

// ADR-0469 floor (Chromium 108) on a fresh Chromium: the realm loses the Chrome 114
// `ArrayBuffer.prototype.detached` before the module loads, so any read of it, in any
// syntax, fails install. Install and the moved-port verdict must not depend on it.
test('port reference installs and sees a moved port without ArrayBuffer.prototype.detached', async ({
  page,
}) => {
  await gotoHarness(page);
  const rows = await page.evaluate(async (url) => {
    const removed = delete (ArrayBuffer.prototype as { detached?: boolean }).detached;
    const out = [
      `removed=${removed && !('detached' in ArrayBuffer.prototype)}`,
      `before=${'ref' in MessagePort.prototype}`,
    ];
    const { installMessagePortReference } = await import(/* @vite-ignore */ url);
    installMessagePortReference();
    type Port = MessagePort & { ref(): void; unref(): void; hasRef(): boolean };
    const { port1: kept, port2: sent } = new MessageChannel() as unknown as {
      port1: Port;
      port2: Port;
    };
    const copy = structuredClone(sent, { transfer: [sent] }) as MessagePort;
    try {
      kept.ref();
      out.push('ref-peer-transferred=no-throw');
    } catch (error) {
      out.push(`ref-peer-transferred=${(error as { feature?: string }).feature}`);
    }
    const { port1: local, port2: peer } = new MessageChannel() as unknown as {
      port1: Port;
      port2: Port;
    };
    local.ref();
    out.push(`ref-local=${local.hasRef()}`);
    local.unref();
    for (const port of [copy, kept, local, peer]) port.close();
    return out;
  }, messagePortRefUrl);
  expect(rows).toEqual([
    'removed=true',
    'before=false',
    'ref-peer-transferred=MessagePort.ref.transferred',
    'ref-local=true',
  ]);
});
