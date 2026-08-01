import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import type {
  PackageBinClaim,
  PackageBinSource,
  PreparedInstallPackage,
  ResolvedPackage,
} from './linker.ts';

const encoder = new TextEncoder();

type LinkFiles = (
  vfs: Vfs,
  root: string,
  packages: readonly PreparedInstallPackage[],
  checkpoint: () => void,
) => Promise<void>;
type LinkBins = (
  vfs: Vfs,
  root: string,
  claims: readonly PackageBinClaim[],
  checkpoint: () => void,
) => Promise<void>;

interface PhaseApi {
  linkInstallPackageFiles: LinkFiles;
  linkInstallPackageBins: LinkBins;
}

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false;
type ExportOr<TKey extends PropertyKey, TFallback> = TKey extends keyof typeof linker
  ? (typeof linker)[TKey]
  : TFallback;
type AcceptAnythingPhase = (...args: unknown[]) => unknown;

const exactFiles: Same<ExportOr<'linkInstallPackageFiles', LinkFiles>, LinkFiles> = true;
const exactBins: Same<ExportOr<'linkInstallPackageBins', LinkBins>, LinkBins> = true;
void [exactFiles, exactBins];

type FileWitness = ExportOr<'linkInstallPackageFiles', AcceptAnythingPhase>;
type BinWitness = ExportOr<'linkInstallPackageBins', AcceptAnythingPhase>;

function proveNarrowPhaseTypes(
  linkFiles: FileWitness,
  linkBins: BinWitness,
  vfs: Vfs,
  raw: ResolvedPackage,
  prepared: PreparedInstallPackage,
  source: PackageBinSource,
  claim: PackageBinClaim,
): void {
  void linkFiles(vfs, '/project', [prepared], () => {});
  void linkBins(vfs, '/project', [claim], () => {});
  // @ts-expect-error Contract: raw packages cannot enter the prepared-file phase.
  linkFiles(vfs, '/project', [raw], () => {});
  // @ts-expect-error Contract: detached claims cannot enter the prepared-file phase.
  linkFiles(vfs, '/project', [claim], () => {});
  // @ts-expect-error Contract: raw packages cannot enter the detached-bin phase.
  linkBins(vfs, '/project', [raw], () => {});
  // @ts-expect-error Contract: narrow sources cannot enter the detached-bin phase.
  linkBins(vfs, '/project', [source], () => {});
  // @ts-expect-error Contract: prepared packages cannot enter the detached-bin phase.
  linkBins(vfs, '/project', [prepared], () => {});
}
void proveNarrowPhaseTypes;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class ProbeVfs extends MemoryVfs {
  readonly targetPaths = new Set<string>();
  readonly launcherPaths = new Set<string>();
  readonly targetReads: string[] = [];
  readonly launcherAttempts: string[] = [];
  readonly events: string[] = [];
  readonly writeStarted = deferred();
  readonly releaseWrite = deferred();
  readonly readStarted = deferred();
  readonly releaseRead = deferred();
  parkedWritePath?: string;
  parkedReadPath?: string;
  failedLauncherPath?: string;
  launcherFailure?: Error;

  override async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (path.endsWith('/.bin')) this.events.push(`bin-mkdir:${path}`);
    await super.mkdir(path, options);
  }

  override async readFile(path: string): Promise<Uint8Array> {
    if (this.targetPaths.has(path)) {
      this.targetReads.push(path);
      this.events.push(`target-read:${path}`);
    }
    if (path === this.parkedReadPath) {
      this.readStarted.resolve();
      await this.releaseRead.promise;
    }
    return await super.readFile(path);
  }

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    if (this.launcherPaths.has(path)) {
      this.launcherAttempts.push(path);
      this.events.push(`launcher-write:${path}`);
      if (path === this.failedLauncherPath && this.launcherFailure) throw this.launcherFailure;
    }
    if (path === this.parkedWritePath) {
      this.writeStarted.resolve();
      await this.releaseWrite.promise;
    }
    await super.writeFile(path, data);
    if (!this.launcherPaths.has(path)) this.events.push(`file-complete:${path}`);
  }

  resetBinLedger(): void {
    this.targetReads.length = 0;
    this.launcherAttempts.length = 0;
    this.events.length = 0;
  }
}

function requirePhase<TKey extends keyof PhaseApi>(name: TKey): PhaseApi[TKey] {
  const candidate = (linker as unknown as Partial<PhaseApi>)[name];
  expect(candidate, `${name} package-private linker seam`).toBeTypeOf('function');
  if (typeof candidate !== 'function') throw new Error(`Contract RED: linker is missing ${name}`);
  return candidate as PhaseApi[TKey];
}

function pkg(
  name: string,
  nodeModulesDir: string,
  command: string,
  target: string,
  includeTarget = true,
): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    installPath: `${nodeModulesDir}/${name}`,
    dependencies: {},
    bin: { [command]: target },
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      ...(includeTarget ? { [target]: encoder.encode(`export const owner = '${name}';\n`) } : {}),
    },
  };
}

function pair(nodeModulesDir: string, prefix: string): readonly ResolvedPackage[] {
  return [
    pkg(`${prefix}-first`, nodeModulesDir, `${prefix}-one`, 'bin/first.js'),
    pkg(`${prefix}-second`, nodeModulesDir, `${prefix}-two`, 'bin/second.js'),
  ];
}

function targetPath(root: string, claim: PackageBinClaim): string {
  return `${root}/${claim.nodeModulesDir}/${claim.owner}/${claim.target}`;
}

function launcherPath(root: string, claim: PackageBinClaim): string {
  return `${root}/${claim.nodeModulesDir}/.bin/${claim.command}`;
}

function shim(claim: PackageBinClaim): string {
  return `#!/usr/bin/env node\nimport('../${claim.owner}/${claim.target}');\n`;
}

async function project(packages: readonly ResolvedPackage[]) {
  const vfs = new ProbeVfs();
  await vfs.mkdir('/project', { recursive: true });
  const prepared = linker.preflightPackageInstallPaths(packages);
  const claims = structuredClone(linker.preflightPackageBins(prepared));
  for (const claim of claims) {
    vfs.targetPaths.add(targetPath('/project', claim));
    vfs.launcherPaths.add(launcherPath('/project', claim));
  }
  return { vfs, prepared, claims };
}

async function expectExactLaunchers(vfs: ProbeVfs, claims: readonly PackageBinClaim[]) {
  for (const claim of claims) {
    expect(await vfs.readFileText(launcherPath('/project', claim))).toBe(shim(claim));
  }
}

type ComposedEntrypoint = 'public' | 'cancellable' | 'prepared';

async function linkComposed(
  entrypoint: ComposedEntrypoint,
  vfs: Vfs,
  packages: readonly ResolvedPackage[],
  prepared: readonly PreparedInstallPackage[],
): Promise<void> {
  if (entrypoint === 'public') return npmClientRoot.link(vfs, '/project', packages);
  if (entrypoint === 'cancellable') {
    return linker.linkInstallTree(vfs, '/project', packages, () => {});
  }
  return linker.linkPreparedInstallTree(vfs, '/project', prepared, () => {});
}

interface ObservedPackage {
  readonly value: ResolvedPackage;
  readonly pathReads: () => number;
  readonly binReads: () => number;
  readonly poisonRawAuthority: () => void;
}

function observedPackage(value: ResolvedPackage): ObservedPackage {
  const installPath = value.installPath;
  const bin = value.bin;
  let pathReads = 0;
  let binReads = 0;
  Object.defineProperty(value, 'installPath', {
    configurable: true,
    enumerable: true,
    get: () => {
      pathReads += 1;
      if (pathReads > 1) throw new Error('raw installPath read after preparation');
      return installPath;
    },
  });
  Object.defineProperty(value, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      binReads += 1;
      if (binReads > 1) throw new Error('raw bin metadata read after claim admission');
      return bin;
    },
  });
  return {
    value,
    pathReads: () => pathReads,
    binReads: () => binReads,
    poisonRawAuthority: () => {
      for (const key of ['installPath', 'bin'] as const) {
        Object.defineProperty(value, key, {
          configurable: true,
          enumerable: true,
          get: () => {
            throw new Error(`raw ${key} read after detached claim creation`);
          },
        });
      }
    },
  };
}

describe('package-bin phased linker authority', () => {
  it.each(['public', 'cancellable', 'prepared'] as const)(
    '[fault: observable-order] %s settles every package file before the first bin operation',
    async (entrypoint) => {
      const packages = pair('node_modules', `order-${entrypoint}`);
      const { vfs, prepared, claims } = await project(packages);
      vfs.parkedWritePath = targetPath('/project', claims[1] as PackageBinClaim);

      const linking = linkComposed(entrypoint, vfs, packages, prepared);
      await vfs.writeStarted.promise;
      const prematureBinEvents = vfs.events.filter((event) => !event.startsWith('file-complete:'));
      const parkedFileCompleted = vfs.events.includes(`file-complete:${vfs.parkedWritePath}`);
      vfs.releaseWrite.resolve();
      await linking;

      expect.soft(parkedFileCompleted).toBe(false);
      expect.soft(prematureBinEvents).toEqual([]);
      const firstBin = vfs.events.findIndex((event) => !event.startsWith('file-complete:'));
      const lastFile = vfs.events.findLastIndex((event) => event.startsWith('file-complete:'));
      expect.soft(firstBin).toBeGreaterThan(-1);
      expect.soft(lastFile).toBeGreaterThan(-1);
      expect(firstBin).toBeGreaterThan(lastFile);
      expect(vfs.targetReads).toEqual(claims.map((claim) => targetPath('/project', claim)));
      expect(vfs.launcherAttempts).toEqual(claims.map((claim) => launcherPath('/project', claim)));
    },
  );

  it.each(['public', 'cancellable', 'prepared', 'phased'] as const)(
    '[fault: sibling-drift] %s uses one non-empty detached target/launcher ledger',
    async (entrypoint) => {
      const root = observedPackage(pkg('phase-root', 'node_modules', 'phase-root', 'bin/root.js'));
      const nested = observedPackage(
        pkg('phase-nested', 'node_modules/host/node_modules', 'nested-phase', 'bin/nested.js'),
      );
      const packages = [root.value, nested.value];
      const claims: readonly PackageBinClaim[] = [
        {
          nodeModulesDir: 'node_modules',
          command: 'phase-root',
          owner: 'phase-root',
          target: 'bin/root.js',
        },
        {
          nodeModulesDir: 'node_modules/host/node_modules',
          command: 'nested-phase',
          owner: 'phase-nested',
          target: 'bin/nested.js',
        },
      ];
      const vfs = new ProbeVfs();
      await vfs.mkdir('/project', { recursive: true });
      const expectedTargets = claims.map((claim) => targetPath('/project', claim));
      const expectedLaunchers = claims.map((claim) => launcherPath('/project', claim));
      for (const target of expectedTargets) vfs.targetPaths.add(target);
      for (const launcher of expectedLaunchers) vfs.launcherPaths.add(launcher);

      if (entrypoint === 'phased') {
        const linkFiles = requirePhase('linkInstallPackageFiles');
        const linkBins = requirePhase('linkInstallPackageBins');
        expect(npmClientRoot).not.toHaveProperty('linkInstallPackageFiles');
        expect(npmClientRoot).not.toHaveProperty('linkInstallPackageBins');
        const prepared = linker.preflightPackageInstallPaths(packages);
        const admittedClaims = structuredClone(linker.preflightPackageBins(prepared));
        expect(admittedClaims).toEqual(claims);
        root.poisonRawAuthority();
        nested.poisonRawAuthority();
        await linkFiles(vfs, '/project', prepared, () => {});
        expect(vfs.launcherAttempts).toEqual([]);
        await linkBins(vfs, '/project', admittedClaims, () => {});
      } else if (entrypoint === 'prepared') {
        const prepared = linker.preflightPackageInstallPaths(packages);
        await linker.linkPreparedInstallTree(vfs, '/project', prepared, () => {});
      } else {
        await linkComposed(entrypoint, vfs, packages, []);
      }

      expect.soft(root.pathReads()).toBe(1);
      expect.soft(nested.pathReads()).toBe(1);
      expect.soft(root.binReads()).toBe(1);
      expect.soft(nested.binReads()).toBe(1);
      expect.soft(vfs.targetReads).toEqual(expectedTargets);
      expect(vfs.launcherAttempts).toEqual(expectedLaunchers);
      await expectExactLaunchers(vfs, claims);
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: corrupt-input] keeps a missing %s target loud and repairs exactly',
    async (scope) => {
      const linkFiles = requirePhase('linkInstallPackageFiles');
      const linkBins = requirePhase('linkInstallPackageBins');
      const nodeModulesDir = scope === 'root' ? 'node_modules' : 'node_modules/host/node_modules';
      const packages = [
        pkg(`missing-${scope}`, nodeModulesDir, `missing-${scope}`, 'bin/missing.js', false),
      ];
      const { vfs, prepared, claims } = await project(packages);
      const claim = claims[0] as PackageBinClaim;
      const target = targetPath('/project', claim);
      const launcher = launcherPath('/project', claim);
      await linkFiles(vfs, '/project', prepared, () => {});

      await expect(linkBins(vfs, '/project', claims, () => {})).rejects.toMatchObject({
        code: 'ENOENT',
        path: target,
      });
      expect.soft(vfs.targetReads).toEqual([target]);
      expect.soft(vfs.launcherAttempts).toEqual([]);
      expect(await vfs.exists(launcher)).toBe(false);

      await vfs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
      await vfs.writeFile(target, encoder.encode('export const repaired = true;\n'));
      vfs.resetBinLedger();
      await linkBins(vfs, '/project', claims, () => {});
      expect.soft(vfs.targetReads).toEqual([target]);
      expect.soft(vfs.launcherAttempts).toEqual([launcher]);
      expect(await vfs.readFileText(launcher)).toBe(shim(claim));
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: torn-state] aborts the first of two %s target reads and retries exactly',
    async (scope) => {
      const linkFiles = requirePhase('linkInstallPackageFiles');
      const linkBins = requirePhase('linkInstallPackageBins');
      const nodeModulesDir = scope === 'root' ? 'node_modules' : 'node_modules/host/node_modules';
      const { vfs, prepared, claims } = await project(pair(nodeModulesDir, `abort-${scope}`));
      const targets = claims.map((claim) => targetPath('/project', claim));
      const launchers = claims.map((claim) => launcherPath('/project', claim));
      await linkFiles(vfs, '/project', prepared, () => {});
      vfs.parkedReadPath = targets[0];
      const controller = new AbortController();
      const reason = new Error(`abort ${scope} target read`);
      const checkpoint = (): void => {
        if (controller.signal.aborted) throw controller.signal.reason;
      };

      const linking = linkBins(vfs, '/project', claims, checkpoint);
      await vfs.readStarted.promise;
      controller.abort(reason);
      vfs.releaseRead.resolve();
      await expect(linking).rejects.toBe(reason);
      expect.soft(vfs.targetReads).toEqual([targets[0]]);
      expect.soft(vfs.launcherAttempts).toEqual([]);
      for (const launcher of launchers) expect.soft(await vfs.exists(launcher)).toBe(false);

      vfs.parkedReadPath = undefined;
      vfs.resetBinLedger();
      await linkBins(vfs, '/project', claims, () => {});
      expect.soft(vfs.targetReads).toEqual(targets);
      expect.soft(vfs.launcherAttempts).toEqual(launchers);
      await expectExactLaunchers(vfs, claims);
    },
  );

  it.each([
    ['root', 'ENOSPC'],
    ['root', 'EACCES'],
    ['nested', 'ENOSPC'],
    ['nested', 'EACCES'],
  ] as const)(
    '[fault: quota-perm-fail] keeps %s launcher %s loud, stops later work, and retries exactly',
    async (scope, code) => {
      const linkFiles = requirePhase('linkInstallPackageFiles');
      const linkBins = requirePhase('linkInstallPackageBins');
      const nodeModulesDir = scope === 'root' ? 'node_modules' : 'node_modules/host/node_modules';
      const { vfs, prepared, claims } = await project(
        pair(nodeModulesDir, `fault-${scope}-${code}`),
      );
      const targets = claims.map((claim) => targetPath('/project', claim));
      const launchers = claims.map((claim) => launcherPath('/project', claim));
      await linkFiles(vfs, '/project', prepared, () => {});
      const failure = Object.assign(new Error(`${code}: launcher write denied`), { code });
      vfs.failedLauncherPath = launchers[0];
      vfs.launcherFailure = failure;

      await expect(linkBins(vfs, '/project', claims, () => {})).rejects.toBe(failure);
      expect.soft(vfs.targetReads).toEqual([targets[0]]);
      expect.soft(vfs.launcherAttempts).toEqual([launchers[0]]);
      for (const launcher of launchers) expect.soft(await vfs.exists(launcher)).toBe(false);

      vfs.failedLauncherPath = undefined;
      vfs.launcherFailure = undefined;
      vfs.resetBinLedger();
      await linkBins(vfs, '/project', claims, () => {});
      expect.soft(vfs.targetReads).toEqual(targets);
      expect.soft(vfs.launcherAttempts).toEqual(launchers);
      await expectExactLaunchers(vfs, claims);
    },
  );
});
