# Node CLI eval physical differential carrier probe

Disposable reachability probe, not acceptance coverage or implementation.
Reference host: Node v24.16.0, Playwright 1.60.0, Chromium 148.0.7778.96,
2026-07-30.

The probe writes one identical CJS file to a host temp directory and the active
Node CLI Starter, runs it with the same arguments in native Node and through
the real Workbench terminal/physical node-entry Worker, and compares stdout.
It uses no fake Workbench, child, VFS, or stdio boundary.

Extract the fenced test, run it, then remove the disposable file:

```sh
probe=tests/e2e/.node-entry-differential-carrier-probe.spec.ts
awk '/^```ts e2e-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/runtime-js/reference/node-cli-eval-physical-carrier-probe.md \
  > "$probe"
pnpm exec playwright test tests/e2e/.node-entry-differential-carrier-probe.spec.ts --project=chromium-light --workers=1
rm "$probe"
```

```ts e2e-probe
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  capturePageProblems,
  expectTerminalContains,
  runTerminalLineSettled,
  selectPreset,
  terminalBuffer,
} from './helpers/playground.ts';

const source =
  "console.log('RIFTY_CARRIER:' + JSON.stringify({ args: process.argv.slice(2) }));\n";
const args = ['alpha', 'two words'] as const;

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

test('real Node and the physical Workbench node-entry child share one differential carrier', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = capturePageProblems(page);
  const hostRoot = mkdtempSync(join(tmpdir(), 'rifty-node-entry-carrier-'));
  try {
    const hostEntry = join(hostRoot, 'carrier.cjs');
    writeFileSync(hostEntry, source);
    const native = spawnSync(process.execPath, [hostEntry, ...args], {
      encoding: 'utf8',
    });
    expect({ status: native.status, stderr: native.stderr }).toEqual({ status: 0, stderr: '' });

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await selectPreset(page, 'cli-report');
    await expectTerminalContains(page, '[cli] completed with exit code 0', 120_000);

    await runTerminalLineSettled(
      page,
      `printf ${shellWord(source)} > carrier.cjs`,
      30_000,
    );
    const before = await terminalBuffer(page);
    await runTerminalLineSettled(
      page,
      `node carrier.cjs ${args.map(shellWord).join(' ')}`,
      60_000,
    );
    const delta = (await terminalBuffer(page)).slice(before.length);
    const browserLine = delta.match(/RIFTY_CARRIER:\{[^\r\n]+\}/u)?.[0];
    expect(browserLine).toBe(native.stdout.trim());
    problems.assertNoViteImportErrors();
  } finally {
    rmSync(hostRoot, { recursive: true, force: true });
  }
});
```

Captured terminal result:

```text
Running 1 test using 1 worker
✓ [chromium-light] real Node and the physical Workbench node-entry child share one differential carrier (5.7s)
1 passed (12.5s)
```

This proves the final `cli-report.spec.ts` can own native-Node-vs-Workbench
terminal differentials while the parity runner owns loader/eval semantics and
Workbench unit/fault tests own exact v3 launch validation. The eval source
itself remains RED until implementation.

The parity runner's physical half is already executable through its production
kernel/Node-entry adapter:

```sh
pnpm test:parity stdio-plan-drain-order
```

Captured output:

```text
node-parity-runner: 1 case(s) matching 'stdio-plan-drain-order'
  ✓ child_process/stdio-plan-drain-order.case.ts
all cases match
```

That case creates five real native Workers and pins typed entry bootstrap,
stdin/EOF, separate stdout/stderr, final drain, and exit-before-close. The eval
case extends this proven adapter with ADR-0337's v3 role; it does not add a fake
or execute source in the harness.
