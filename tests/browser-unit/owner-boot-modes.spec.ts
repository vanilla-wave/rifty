import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness, readOwnerFile } from './fixtures.ts';

/**
 * Starter (non-hidden) owner boot against the REAL owner worker (browser-unit
 * lane, ADR-0196) — formerly source-grep-pinned in real-vite-bootstrap.test.ts:
 *   1. Boot seeds the project tree (template seed files + welcome README +
 *      starter baseline + template-owned node_modules files).
 *   2. The owner index bridge serves a synthesized scratch entry keyed on the
 *      spawn STARTER (reconcileOwnerIndexAtBoot) — the hidden-empty boot in
 *      owner-publish-and-persistence.spec.ts is the negative half.
 *   3. Archive export, file reads and the index bridge all answer right after
 *      the ready frame (bridge wiring; the ready-AFTER-bridges ORDER itself is
 *      not page-observable — pinned residually in real-vite-bootstrap.test.ts).
 */

test('starter boot seeds tree + synthesizes scratch index entry; bridges answer post-ready', async ({
  page,
}) => {
  await gotoHarness(page);
  // from-scratch: deps come from an explicit `npm install` only — boot stays
  // network-free; seeding/index/bridge contracts are what this spec pins.
  await bootOwner(page, {
    workspaceId: 'bu-starter-boot',
    template: 'typescript',
    starter: 'typescript-ls',
    setup: 'from-scratch',
    hiddenEmptyBoot: false,
  });

  // 3. Right after ready — no polls: archive + index bridges must answer.
  const bridges = await page.evaluate(async () => {
    const w = window as unknown as {
      __buOwner: { snapshotPort: string | number; exportArchive(): Promise<string> };
    };
    const indexPort = await import('/src/glue/project-index-port.ts');
    const mirror = indexPort.bridgeProjectIndex(w.__buOwner.snapshotPort);
    const index = await new Promise<{
      activeId: string;
      scratch: { starter: string } | null;
    } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 10_000);
      const unsub = mirror.subscribe(
        (idx: { activeId: string; scratch: { starter: string } | null }) => {
          clearTimeout(timer);
          unsub();
          resolve(idx);
        },
      );
    });
    const archive = await w.__buOwner.exportArchive();
    mirror.dispose();
    return { index, archiveHasReadme: archive.includes('README.md') };
  });

  // 2. Synthesized scratch entry records the spawn starter.
  expect(bridges.index).not.toBeNull();
  expect(bridges.index?.activeId).toBe('scratch');
  expect(bridges.index?.scratch?.starter).toBe('typescript-ls');
  expect(bridges.archiveHasReadme).toBe(true);

  // 1. Seeded tree: welcome README, starter baseline entry, template
  //    package.json (dev script), template-owned node_modules seed files.
  const readme = await readOwnerFile(page, '/scratch/README.md');
  expect(readme.ok).toBe(true);
  expect(readme.text).toContain('in-browser virtual filesystem');

  const entry = await readOwnerFile(page, '/scratch/src/main.ts');
  expect(entry.ok).toBe(true);
  expect(entry.text.length).toBeGreaterThan(0);

  const pkg = await readOwnerFile(page, '/scratch/package.json');
  expect(pkg.ok).toBe(true);
  expect(pkg.text).toContain('"dev"');

  const dts = await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts');
  expect(dts.ok).toBe(true);
  expect(dts.text.length).toBeGreaterThan(0);
});
