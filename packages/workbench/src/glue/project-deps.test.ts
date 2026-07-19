import type { InstallResult } from '@riftydev/npm-client';
import type { PersistFailureReport } from '@riftydev/vfs';
import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { type DepSnapshotV2, buildDepSnapshot } from './dep-snapshot.ts';
import {
  type InstallStampAuthority,
  type InstallStampPromotionResult,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import { installStampSatisfied, readInstallStamp } from './install-stamp.ts';
import {
  ensureProjectDependencies,
  prepareProjectInstallTree,
  seedTemplateNodeModulesFiles,
  templateNodeModulesSeedMutationIntents,
} from './project-deps.ts';
import { ScopedFsSync, ScopedVfs, workspaceVfsPrefix } from './scoped-vfs.test-fixture.ts';

const ROOT = '/workspace';
const enc = new TextEncoder();
const packageJsonText = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'app', dependencies: deps });
const VITE_PACKAGE_JSON_TEXT = packageJsonText({ vite: '^5.4.0' });

function installResult(count: number): InstallResult {
  const packages = Array.from({ length: count }, (_, index) => ({
    name: `package-${index}`,
    version: '1.0.0',
    dependencies: {},
    files: {},
  }));
  return {
    packages,
    lockfile: {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: packages.map(({ name, version }) => ({ name, version, transport: 'registry' })),
    },
  };
}

function installedResult(fsSync: MemoryFsSync, count: number): InstallResult {
  const result = installResult(count);
  fsSync.writeFileSync(
    `${ROOT}/package-lock.json`,
    enc.encode(JSON.stringify(result.lockfile, null, 2)),
  );
  return result;
}

function viteSnapshot(): DepSnapshotV2 {
  const fs = new MemoryFsSync();
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(`${ROOT}/package.json`, enc.encode(VITE_PACKAGE_JSON_TEXT));
  fs.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  fs.writeFileSync(`${ROOT}/node_modules/vite/package.json`, enc.encode('{"name":"vite"}'));
  fs.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}'));
  return buildDepSnapshot(fs, ROOT, { templateId: 'vite', deps: { vite: '^5.4.0' }, packages: 8 });
}

function project(deps: Record<string, string> = { vite: '^5.4.0' }) {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync(ROOT, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(packageJsonText(deps)));
  const log: string[] = [];
  return { vfs, fsSync, log, logFn: (line: string) => log.push(line) };
}

async function seedTrustedStamp(
  target: Pick<ReturnType<typeof project>, 'vfs' | 'fsSync'>,
  slug: string,
  packages: number,
): Promise<void> {
  const authority = createInstallStampAuthority(target);
  if (!target.fsSync.existsSync(`${ROOT}/package-lock.json`)) {
    installedResult(target.fsSync, packages);
  }
  const packageJsonText = await target.vfs.readFileText(`${ROOT}/package.json`);
  const claim = await authority.demote({ root: ROOT, slug });
  const result = await authority.promote(
    { root: ROOT, slug, packageJsonText },
    { epoch: claim.epoch, packages },
  );
  if (result.status !== 'trusted') throw new Error(`test setup failed: ${result.status}`);
}

function trackPromotionSettlements(
  options: Parameters<typeof createInstallStampAuthority>[0],
): Readonly<{
  authority: InstallStampAuthority;
  settled(index?: number): Promise<void>;
}> {
  const inner = createInstallStampAuthority(options);
  const settlements: Promise<InstallStampPromotionResult>[] = [];
  const authority: InstallStampAuthority = {
    ...inner,
    admitPromotion: async (identity, transition) => {
      const admission = await inner.admitPromotion(identity, transition);
      settlements.push(admission.settlement);
      return admission;
    },
  };
  return {
    authority,
    async settled(index = settlements.length - 1): Promise<void> {
      const settlement = settlements[index];
      if (settlement === undefined)
        throw new Error(`missing promotion settlement ${String(index)}`);
      await settlement;
      // The authority's detached reporter subscribed before this test barrier.
      await Promise.resolve();
    },
  };
}

describe('ensureProjectDependencies (ADR-0135)', () => {
  it('preserves a same-project covering lock while clearing a cold stale tree', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
    fs.writeFileSync(`${ROOT}/node_modules/pkg/index.js`, enc.encode('stale'));
    fs.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}\n'));

    prepareProjectInstallTree(fs, ROOT, {
      packageJsonText: VITE_PACKAGE_JSON_TEXT,
      currentSlug: 'scratch',
      priorSlug: 'scratch',
      priorTrustedTree: false,
    });

    expect(fs.existsSync(`${ROOT}/node_modules`)).toBe(false);
    expect(fs.existsSync(`${ROOT}/package-lock.json`)).toBe(true);
  });

  it('preserves a warm trusted same-project tree and covering lock', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
    fs.writeFileSync(`${ROOT}/node_modules/pkg/index.js`, enc.encode('warm'));
    fs.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}\n'));

    prepareProjectInstallTree(fs, ROOT, {
      packageJsonText: VITE_PACKAGE_JSON_TEXT,
      currentSlug: 'scratch',
      priorSlug: 'scratch',
      priorTrustedTree: true,
    });

    expect(fs.existsSync(`${ROOT}/node_modules/pkg/index.js`)).toBe(true);
    expect(fs.existsSync(`${ROOT}/package-lock.json`)).toBe(true);
  });

  it('clears a foreign tree and lock before project acquisition', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
    fs.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}\n'));

    prepareProjectInstallTree(fs, ROOT, {
      packageJsonText: VITE_PACKAGE_JSON_TEXT,
      currentSlug: 'scratch',
      priorSlug: 'other-project',
      priorTrustedTree: false,
    });

    expect(fs.existsSync(`${ROOT}/node_modules`)).toBe(false);
    expect(fs.existsSync(`${ROOT}/package-lock.json`)).toBe(false);
  });

  it('seeds only missing template-owned node_modules files and preserves existing bytes', () => {
    const { fsSync } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules/@rifty/types`, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/node_modules/@rifty/types/existing.d.ts`, enc.encode('user'));

    seedTemplateNodeModulesFiles(fsSync, ROOT, {
      [`${ROOT}/node_modules/@rifty/types/existing.d.ts`]: 'template',
      [`${ROOT}/node_modules/@rifty/types/missing.d.ts`]: 'declare const value: 1',
      [`${ROOT}/node_modules-evil/escape.js`]: 'outside package tree',
      [`${ROOT}/src/ignored.ts`]: 'outside package tree',
    });

    expect(
      new TextDecoder().decode(
        fsSync.readFileBytesSync(`${ROOT}/node_modules/@rifty/types/existing.d.ts`),
      ),
    ).toBe('user');
    expect(
      new TextDecoder().decode(
        fsSync.readFileBytesSync(`${ROOT}/node_modules/@rifty/types/missing.d.ts`),
      ),
    ).toBe('declare const value: 1');
    expect(fsSync.existsSync(`${ROOT}/node_modules-evil/escape.js`)).toBe(false);
    expect(fsSync.existsSync(`${ROOT}/src/ignored.ts`)).toBe(false);
  });

  it('seeds exact binary template-owned node_modules bytes', () => {
    const { fsSync } = project();
    const path = `${ROOT}/node_modules/@rifty/types/fixture.bin`;
    const bytes = new Uint8Array([0, 255, 7, 128]);

    seedTemplateNodeModulesFiles(fsSync, ROOT, { [path]: bytes } as never);

    expect(fsSync.readFileBytesSync(path)).toEqual(bytes);
  });

  it('reports exact missing template node_modules writes without prefix siblings', () => {
    const { fsSync } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules/@rifty/types`, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/node_modules/@rifty/types/existing.d.ts`, enc.encode('user'));

    expect(
      templateNodeModulesSeedMutationIntents(fsSync, ROOT, {
        [`${ROOT}/node_modules/@rifty/types/existing.d.ts`]: 'template',
        [`${ROOT}/node_modules/@rifty/types/missing.d.ts`]: 'missing',
        [`${ROOT}/node_modules-evil/escape.js`]: 'outside package tree',
      }),
    ).toEqual([{ kind: 'write', path: `${ROOT}/node_modules/@rifty/types/missing.d.ts` }]);
  });

  it('rejects a file at the exact node_modules root from both template seed paths', () => {
    const { fsSync } = project();
    const corruptSeed = { [`${ROOT}/node_modules`]: 'corrupt-file' };

    expect(templateNodeModulesSeedMutationIntents(fsSync, ROOT, corruptSeed)).toEqual([]);
    seedTemplateNodeModulesFiles(fsSync, ROOT, corruptSeed);
    expect(fsSync.existsSync(`${ROOT}/node_modules`)).toBe(false);
  });

  it('reuses a stamp written under the SAME slug without fetching or installing', async () => {
    const { vfs, fsSync, log, logFn } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
    await seedTrustedStamp({ vfs, fsSync }, 'project-files', 8);

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => {
        throw new Error('must not fetch on a stamp hit');
      },
      install: async () => {
        throw new Error('must not install on a stamp hit');
      },
      log: logFn,
    });

    expect(result).toEqual({ source: 'stamp', packages: 8 });
    expect(log.join('')).toContain('install skipped');
  });

  it('ignores a stamp written under a DIFFERENT slug — the from-scratch install still runs', async () => {
    // project-files (instant) stamped OPFS for the shared vite deps; selecting
    // real-vite (from-scratch, no snapshot) must still install, not reuse.
    const { vfs, fsSync, log, logFn } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
    await seedTrustedStamp({ vfs, fsSync }, 'project-files', 8);
    let installed = false;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'real-vite',
      fetchSnapshot: async () => {
        throw new Error('from-scratch must not consult the snapshot');
      },
      install: async () => {
        installed = true;
        fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
        return installedResult(fsSync, 8);
      },
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 8 });
    expect(installed).toBe(true);
    expect(log.join('')).not.toContain('install skipped');
    // re-selecting the SAME slug now reuses the tree it just stamped.
    expect((await installStampSatisfied(vfs, ROOT, 'real-vite'))?.packages).toBe(8);
  });

  it('clears a foreign preset tree + lockfile BEFORE the from-scratch install (no EBROKENLOCK)', async () => {
    // project-files (instant) restored a baked snapshot: node_modules/vite + a
    // package-lock.json that omits the shimmed esbuild. Selecting real-vite
    // (from-scratch, same `vite` template → the owner's templateId-keyed clean
    // skips it) must NOT install over that tree — the stale lockfile trips the
    // installer's coverage check (EBROKENLOCK). The arrival clears the foreign
    // tree first so install() sees a truly from-scratch base.
    const { vfs, fsSync, logFn } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/node_modules/vite/package.json`, enc.encode('{"name":"vite"}'));
    fsSync.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}'));
    await seedTrustedStamp({ vfs, fsSync }, 'project-files', 8); // a DIFFERENT slug's stamp

    let treeAtInstall: { lockfile: boolean; viteDir: boolean } | null = null;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'real-vite', // from-scratch: no snapshotUrl
      install: async () => {
        treeAtInstall = {
          lockfile: fsSync.existsSync(`${ROOT}/package-lock.json`),
          viteDir: fsSync.existsSync(`${ROOT}/node_modules/vite`),
        };
        return installedResult(fsSync, 8);
      },
      log: logFn,
    });

    expect(result.source).toBe('install');
    // The foreign tree is gone at install time — a clean from-scratch base.
    expect(treeAtInstall).toEqual({ lockfile: false, viteDir: false });
  });

  it('restores the baked snapshot on a stampless boot and stamps the tree', async () => {
    const { vfs, fsSync, log, logFn } = project();
    let installed = false;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => {
        installed = true;
        return installedResult(fsSync, 0);
      },
      log: logFn,
    });

    expect(result).toEqual({ source: 'snapshot', packages: 8 });
    expect(installed).toBe(false);
    expect(fsSync.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(true);
    expect(fsSync.existsSync(`${ROOT}/package-lock.json`)).toBe(true);
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(8);
    expect(log.join('')).toContain('baked node_modules restored');
  });

  it.each([
    ['top claim', '.rifty-install-stamp.json', 'e30='],
    ['nested claim', 'pkg/node_modules/.rifty-install-stamp.json', 'e30='],
    ['unsafe path', '../escape.js', 'e30='],
    ['malformed base64', 'vite/bad.js', '***'],
  ])(
    'rejects %s during snapshot planning with the real Owner destination byte-identical',
    async (_case, path, content) => {
      const pair = createMemoryFs();
      pair.fsSync.mkdirSync(`${ROOT}/node_modules/existing`, { recursive: true });
      pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(VITE_PACKAGE_JSON_TEXT));
      installedResult(pair.fsSync, 1);
      pair.fsSync.writeFileSync(`${ROOT}/node_modules/existing/index.js`, enc.encode('keep'));
      const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
        pair.fsSync,
        { ownerEpoch: `snapshot-plan-${_case}` },
      );
      const stamps = createInstallStampAuthority({
        vfs: pair.vfs,
        fsSync: owner,
        claimIo: installStampClaims,
      });
      const foreign = await stamps.demote({ root: ROOT, slug: 'foreign' });
      await stamps.promote(
        { root: ROOT, slug: 'foreign', packageJsonText: VITE_PACKAGE_JSON_TEXT },
        { epoch: foreign.epoch, packages: 1 },
      );
      const snapshot = viteSnapshot();
      const corrupt: DepSnapshotV2 = {
        ...snapshot,
        nodeModules: {
          ...snapshot.nodeModules,
          files: [...snapshot.nodeModules.files, { path, encoding: 'base64', content }],
        },
      };
      const before = owner.snapshot();

      const result = await ensureProjectDependencies({
        vfs: pair.vfs,
        fsSync: owner,
        installStampAuthority: stamps,
        root: ROOT,
        templateId: 'vite',
        slug: 'project-files',
        snapshotUrl: '/snapshots/corrupt.json.gz',
        fetchSnapshot: async () => corrupt,
        replaceTreeOnMiss: true,
        log: () => undefined,
      });

      expect(result).toEqual({ source: 'none', packages: 0 });
      expect(owner.snapshot()).toEqual(before);
      await expect(stamps.check({ root: ROOT, slug: 'foreign' })).resolves.toMatchObject({
        status: 'trusted',
      });
    },
  );

  it('falls back to install when the snapshot deps drift from package.json', async () => {
    const { vfs, fsSync, log, logFn } = project({ vite: '^6.0.0' });

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => {
        fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
        return installedResult(fsSync, 9);
      },
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(log.join('')).toContain('stale');
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(9);
  });

  it('falls back to install when the snapshot asset is unavailable', async () => {
    const { vfs, fsSync, log, logFn } = project();

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => null,
      install: async () => installedResult(fsSync, 9),
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(log.join('')).toContain('unavailable');
  });

  it('reports the exact snapshot fetch failure before a successful install fallback', async () => {
    const { vfs, fsSync, log, logFn } = project();

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => {
        throw new Error('HTTP 404 Not Found');
      },
      install: async () => installedResult(fsSync, 9),
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(log.join('')).toContain(
      'baked snapshot unavailable (/snapshots/vite.json.gz): HTTP 404 Not Found — falling back to install',
    );
  });

  it('installs directly when the template has no baked snapshot', async () => {
    const { vfs, fsSync, logFn } = project({ express: '^4.19.0' });

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'express-sqlite',
      slug: 'express-sqlite',
      fetchSnapshot: async () => {
        throw new Error('must not fetch without a snapshot url');
      },
      install: async () => {
        fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
        return installedResult(fsSync, 60);
      },
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 60 });
    expect((await installStampSatisfied(vfs, ROOT, 'express-sqlite'))?.packages).toBe(60);
  });

  it('writes only a pending stamp without draining the write-through on the snapshot path (ADR-0187)', async () => {
    const { vfs, fsSync, logFn } = project();

    // Tripwire: `flush` powers only the DEFERRED stamp-durability check
    // (ADR-0187 Corrected) and is NEVER awaited on the boot critical path —
    // durability ordering is the write-through FIFO (pinned in
    // opfs-sync.test.ts). If a future change re-awaits a drain around the
    // stamp, this never-resolving flush hangs the arrival and the test
    // times out RED.
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => installedResult(fsSync, 0),
      log: logFn,
      flush: () => new Promise(() => {}),
    });

    expect(result.source).toBe('snapshot');
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
  });

  it('leaves the pending stamp untrusted when the single proof drain reports tree persist failures', async () => {
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    type Report = {
      failures: Array<{ path: string; op: 'write'; message: string }>;
      total: number;
    };
    let resolveFlush!: (report: Report) => void;
    let flushCalls = 0;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      // The one controlled proof drain starts after the pending claim lands and
      // does not block dependency arrival.
      flush: (): Promise<Report> => {
        flushCalls += 1;
        return new Promise<Report>((r) => {
          resolveFlush = r;
        });
      },
    });
    expect(result.source).toBe('snapshot');
    // The pending stamp landed non-blocking, BEFORE the drain settled, but it is
    // untrusted until the deferred durability check promotes it.
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();

    // …then the drain reports a TREE file that never persisted.
    resolveFlush({
      failures: [
        {
          path: `${ROOT}/node_modules/vite/package.json`,
          op: 'write',
          message: 'QuotaExceededError',
        },
      ],
      total: 1,
    });
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(log.join('')).toContain('pending claim remains untrusted');
    expect(log.join('')).not.toContain('CRITICAL');
    expect(flushCalls).toBe(1);
  });

  it('leaves a scoped-workspace pending stamp untrusted when OPFS reports physical tree damage', async () => {
    const { vfs: innerVfs, fsSync: innerFs } = createMemoryFs();
    const prefix = workspaceVfsPrefix('active');
    const vfs = new ScopedVfs(innerVfs, prefix);
    const fsSync = new ScopedFsSync(innerFs, prefix);
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(
      `${ROOT}/package.json`,
      enc.encode(JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } })),
    );
    const log: string[] = [];
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let flushCalls = 0;
    (innerFs as typeof innerFs & { flush: () => Promise<PersistFailureReport> }).flush =
      async () => {
        flushCalls += 1;
        return {
          failures: [
            {
              path: `${prefix}${ROOT}/node_modules/vite/package.json`,
              op: 'write',
              message: 'QuotaExceededError',
            },
          ],
          total: 1,
        };
      };

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: (line) => log.push(line),
      flush: () => fsSync.flush(),
    });

    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(log.join('')).toContain('pending claim remains untrusted');
    expect(flushCalls).toBe(1);
  });

  it('does NOT revoke on a FOREIGN persist failure — a global path (learned pins, another project) is not this tree torn', async () => {
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let flushCalls = 0;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: async () => {
        flushCalls += 1;
        return {
          // Outside `<root>/node_modules` → not the stamped tree.
          failures: [
            {
              path: '/.rifty/eddy-learned-pins.json',
              op: 'write' as const,
              message: 'QuotaExceededError',
            },
          ],
          total: 1,
        };
      },
    });
    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).not.toBeNull(); // kept
    expect(log.join('')).not.toContain('discarded');
    expect(log.join('')).not.toContain('revoked');
    expect(flushCalls).toBe(1);
  });

  it('keeps a pending claim untrusted on tree damage beyond the sample — the full ledger gates', async () => {
    // The report sample is all foreign (tree damage sits outside the first
    // PERSIST_REPORT_SAMPLE); `anyFailure` scans the whole ledger and sees the
    // node_modules failure. Scanning only `failures` would trust a torn tree.
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    const treePath = `${ROOT}/node_modules/vite/package.json`;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: async () => ({
        failures: [
          { path: '/.rifty/eddy-learned-pins.json', op: 'write' as const, message: 'Quota' },
        ],
        total: 21,
        anyFailure: (pred: (p: string) => boolean) =>
          pred('/.rifty/eddy-learned-pins.json') || pred(treePath),
      }),
    });
    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(log.join('')).toContain('pending claim remains untrusted');
  });

  it('does not delete or re-drain a pending claim after a dirty proof', async () => {
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let flushCalls = 0;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: async () => {
        flushCalls += 1;
        return {
          failures: [
            {
              path: `${ROOT}/node_modules/vite/package.json`,
              op: 'write' as const,
              message: 'QuotaExceededError',
            },
          ],
          total: 1,
        };
      },
    });
    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(log.join('')).toContain('pending claim remains untrusted');
    expect(log.join('')).not.toContain('delete');
    expect(log.join('')).not.toContain('CRITICAL');
    expect(flushCalls).toBe(1);
  });

  it('a deferred-drain failure on the STAMP FILE ITSELF leaves the pending stamp untrusted', async () => {
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: async () => ({
        failures: [
          {
            path: `${ROOT}/node_modules/.rifty-install-stamp.json`,
            op: 'write' as const,
            message: 'QuotaExceededError',
          },
        ],
        total: 1,
      }),
    });
    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(log.join('')).toContain('promotion skipped');
    expect(log.join('')).not.toContain('revoked');
  });

  it('a CLEAN deferred drain keeps the stamp', async () => {
    const { vfs, fsSync, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let flushCalls = 0;
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: async () => {
        flushCalls += 1;
        return { failures: [], total: 0 };
      },
    });
    expect(result.source).toBe('snapshot');
    await promotion.settled();
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).not.toBeNull();
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBeUndefined();
    expect(flushCalls).toBe(1);
  });

  it('does not let an older deferred promoter trust a newer pending restore', async () => {
    const { vfs, fsSync, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let resolveFirstFlush!: (report: PersistFailureReport) => void;

    await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: () =>
        new Promise<PersistFailureReport>((resolve) => {
          resolveFirstFlush = resolve;
        }),
    });
    const firstPending = await readInstallStamp(vfs, ROOT);
    expect(firstPending?.durability).toBe('pending');

    await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: () => new Promise(() => {}),
    });
    const secondPending = await readInstallStamp(vfs, ROOT);
    expect(secondPending?.durability).toBe('pending');
    expect(secondPending?.epoch).not.toBe(firstPending?.epoch);

    resolveFirstFlush({ failures: [], total: 0 });
    await promotion.settled(0);

    const afterOldPromoter = await readInstallStamp(vfs, ROOT);
    expect(afterOldPromoter?.durability).toBe('pending');
    expect(afterOldPromoter?.epoch).toBe(secondPending?.epoch);
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
  });

  it('a command-site demote landing during an older promoter drain cannot be overwritten', async () => {
    const { vfs, fsSync, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let resolveFlush!: (report: PersistFailureReport) => void;

    await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: () =>
        new Promise<PersistFailureReport>((resolve) => {
          resolveFlush = resolve;
        }),
    });
    const older = await readInstallStamp(vfs, ROOT);
    expect(older?.durability).toBe('pending');

    // Same authority as the terminal command: demote issues a newer epoch
    // immediately while the older promoter is outside the write queue.
    const commandClaim = await promotion.authority.demote({
      root: ROOT,
      slug: 'project-files',
    });

    resolveFlush({ failures: [], total: 0 });
    await promotion.settled();

    // The demote survives; the stale promoter must NOT have trusted the tree.
    const after = await readInstallStamp(vfs, ROOT);
    expect(after?.durability).toBe('pending');
    expect(after?.epoch).toBe(commandClaim.epoch);
    expect(after?.epoch).not.toBe(older?.epoch);
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
  });

  it('does not promote a pending stamp after package.json deps drift', async () => {
    const { vfs, fsSync, log, logFn } = project();
    const promotion = trackPromotionSettlements({ vfs, fsSync });
    let resolveFirstFlush!: (report: PersistFailureReport) => void;
    let flushCalls = 0;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority: promotion.authority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      log: logFn,
      flush: () => {
        flushCalls += 1;
        if (flushCalls === 1) {
          return new Promise<PersistFailureReport>((resolve) => {
            resolveFirstFlush = resolve;
          });
        }
        return Promise.resolve({ failures: [], total: 0 });
      },
    });
    expect(result.source).toBe('snapshot');
    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');

    fsSync.writeFileSync(
      `${ROOT}/package.json`,
      enc.encode(JSON.stringify({ name: 'app', dependencies: { vite: '^6.0.0' } })),
    );
    resolveFirstFlush({ failures: [], total: 0 });
    await promotion.settled();

    expect((await readInstallStamp(vfs, ROOT))?.durability).toBe('pending');
    expect(await installStampSatisfied(vfs, ROOT, 'project-files')).toBeNull();
    expect(log.join('')).toContain('package.json deps changed before install stamp promotion');
    expect(log.join('')).toContain('pending claim remains untrusted');
    expect(flushCalls).toBe(1);
  });

  it('restore-only (no `install`): a stampless, snapshotless tree resolves to `none` — NEVER installs', async () => {
    // The faithful boot settles instant deps in RESTORE-ONLY mode. from-scratch deps
    // come SOLELY from the explicit `npm install` command — so omitting `install`
    // leaves a stampless, snapshotless tree's deps ABSENT (`none`); it does not fetch
    // or network-install as a dev-line side effect.
    const { vfs, fsSync, log, logFn } = project();
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'real-vite',
      // no snapshotUrl + no install → restore-only
      log: logFn,
    });
    expect(result).toEqual({ source: 'none', packages: 0 });
    expect(log.join('')).toContain('dependencies remain absent (restore-only mode)');
    expect(log.join('')).not.toContain('falling back to install');
  });

  it('restore-only with no snapshot returns none before any demote', async () => {
    const { vfs, fsSync, logFn } = project();
    const demoteFailure = new Error('durable revocation failed');
    let demoteCalls = 0;
    const installStampAuthority: InstallStampAuthority = {
      check: async () => ({ status: 'absent' }),
      checkSync: () => ({ status: 'absent' }),
      demote: async () => {
        demoteCalls += 1;
        throw demoteFailure;
      },
      prepareTreeMutation: async () => {},
      admitPromotion: async () => ({ settlement: Promise.resolve({ status: 'stale' }) }),
      promote: async () => ({ status: 'stale' }),
      revoke: async () => {},
    };
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      installStampAuthority,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      log: logFn,
    });

    expect(result).toEqual({ source: 'none', packages: 0 });
    expect(demoteCalls).toBe(0);
  });

  it('restore-only with a matching snapshot RESTORES (still never installs)', async () => {
    const { vfs, fsSync, logFn } = project();
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      // no `install` → restore-only; a matching snapshot must restore, not install
      log: logFn,
    });
    expect(result.source).toBe('snapshot');
  });

  it('restore-only accepts a shared baked snapshot when its owner template matches', async () => {
    const { vfs, fsSync, logFn } = project();
    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'typescript',
      snapshotTemplateId: 'vite',
      slug: 'typescript-ls',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      // no `install` → TypeScript starter's instant boot must restore, not install
      log: logFn,
    });
    expect(result.source).toBe('snapshot');
  });
});
