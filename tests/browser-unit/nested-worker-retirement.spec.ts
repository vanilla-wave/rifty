import { stripVTControlCharacters } from 'node:util';
import { type Worker, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';

const ROUNDS = 20;

// Chromium drops a nested Worker's termination notice when its parent realm
// begins shutdown with that notice still queued; the parent thread then never
// shuts down. A killed `mid` settles its nested `leaf` before `top` terminates
// `mid`, so every round exercises that window.
const TOP = `import { spawn } from 'node:child_process';
for (let round = 0; round < ${ROUNDS}; round += 1) {
  const mid = spawn(process.execPath, ['mid.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => mid.stdout.once('data', resolve));
  const exited = new Promise((resolve) => mid.once('exit', (code, signal) => resolve(signal)));
  mid.kill('SIGTERM');
  console.log('round ' + round + ' ' + (await exited));
}
// Idle before exiting: top's own end right after a kill is a separate residual
// (backlog/kernel/nested-worker-notice-drop-residuals).
await new Promise((resolve) => setTimeout(resolve, 500));
`;
const MID = `import { spawn } from 'node:child_process';
const leaf = spawn(process.execPath, ['leaf.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
leaf.stdout.once('data', () => process.stdout.write('ready\\n'));
// Guest work continues in the task that settles the killed leaf.
leaf.once('close', () => {
  let chain = Promise.resolve();
  for (let step = 0; step < 10; step += 1) chain = chain.then(() => {});
  void chain.then(() => {
    const end = Date.now() + 50;
    while (Date.now() < end) {}
  });
});
setInterval(() => {}, 1e6);
`;
const LEAF = `process.stdout.write('up');
setInterval(() => {}, 1e6);
`;

function added(page: { workers(): Worker[] }, baseline: readonly Worker[]): number {
  return page.workers().filter((worker) => !baseline.includes(worker)).length;
}

test('killed process tree retires every nested Worker thread', async ({ page }) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-nested-worker-retirement',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/top.mjs', TOP);
    await writeOwnerFile(page, '/scratch/mid.mjs', MID);
    await writeOwnerFile(page, '/scratch/leaf.mjs', LEAF);
    const baseline = page.workers();

    const run = await runOwnerCommand(page, 'node top.mjs', 120_000);
    const out = stripVTControlCharacters(run.out);
    expect(run.timedOut, out).toBe(false);
    expect(run.exit, out).toBe(0);
    for (let round = 0; round < ROUNDS; round += 1) {
      expect(out).toContain(`round ${round} SIGTERM`);
    }
    // Chromium forcibly terminates a busy Worker 2 s after terminate(); a
    // retired tree is gone well inside 10 s.
    await expect.poll(() => added(page, baseline), { timeout: 10_000 }).toBe(0);
  } finally {
    await closeOwner(page);
  }
});

const LIVE_ROUNDS = 3;

test('Workbench close over a live Vite run retires every kernel Worker', async ({ page }) => {
  test.setTimeout(300_000);
  for (let round = 0; round < LIVE_ROUNDS; round += 1) {
    await gotoHarness(page);
    const kernelUrl = await page.evaluate(async () => {
      const assets = (await import('/src/browser-unit/workbench-vite-host-assets.ts')) as {
        readonly workbenchViteHostAssets: { readonly workers: { readonly kernel: string } };
      };
      return new URL(assets.workbenchViteHostAssets.workers.kernel, location.href).href;
    });
    const preview = await page.evaluate(async (id) => {
      type Run = { readonly ready: Promise<{ readonly url: string }> };
      type Project = { run(): Run };
      type Workbench = {
        openProject(definition: unknown): Promise<Project>;
        close(): Promise<void>;
      };
      type Entry = {
        openWorkbench(options: unknown): Promise<Workbench>;
        readonly projects: { vite(options: unknown): unknown };
      };
      type Assets = {
        readonly workbenchViteHostAssets: {
          readonly workers: Readonly<Record<string, string>>;
          readonly wasm: Readonly<Record<string, string>>;
        };
      };
      const entryUrl = '/src/browser-unit/workbench-public-entry.ts';
      const [entryModule, assetsModule] = await Promise.all([
        import(/* @vite-ignore */ entryUrl),
        import('/src/browser-unit/workbench-vite-host-assets.ts'),
      ]);
      const entry = entryModule as unknown as Entry;
      const assets = (assetsModule as unknown as Assets).workbenchViteHostAssets;
      const ownerUrl = new URL(String(assets.workers.owner), location.href);
      const ownerBase = new URL('.', ownerUrl);
      const base = document.createElement('base');
      base.href = ownerBase.href;
      document.head.prepend(base);
      try {
        const workbench = await entry.openWorkbench({
          deployment: {
            workers: { ...assets.workers, owner: ownerUrl.href.slice(ownerBase.href.length) },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: assets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'ephemeral' },
        });
        const project = await workbench.openProject(
          entry.projects.vite({
            id,
            viteVersion: '7.3.6',
            files: { '/index.html': '<!doctype html><h1>live-close</h1>' },
          }),
        );
        const ready = await project.run().ready;
        const response = await fetch(new URL(ready.url, location.href).href, { cache: 'no-store' });
        const html = await response.text();
        await workbench.close();
        return { status: response.status, html };
      } finally {
        base.remove();
      }
    }, `browser-unit-nested-worker-live-close-${round}`);
    expect(preview.status).toBe(200);
    expect(preview.html).toContain('live-close');
    await expect
      .poll(() => page.workers().filter((worker) => worker.url() === kernelUrl).length, {
        timeout: 10_000,
      })
      .toBe(0);
  }
});
