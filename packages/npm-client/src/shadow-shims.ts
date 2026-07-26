/**
 * Install-time application of shadow-registry internals shims (ADR-0188).
 *
 * Data lives in `@riftydev/shadow-registry` (`internalsShims`, keyed by the
 * INSTALLED trigger package); this adapter owns the companion lockstep
 * contract and the file writes into each pinned copy's actual
 * install path (nested/hoisted-aware) — replacing the playground's boot-time
 * `/workspace`-rooted overlay. Runs on live resolve, lockfile replay, and the
 * eddy-seeded path alike (all converge on `install()`'s post-link step).
 */
import { NotImplementedError } from '@riftydev/io';
import { type InternalsShim, internalsShims } from '@riftydev/shadow-registry';
import { type Vfs, joinPath } from '@riftydev/vfs';
import { type OverrideMap, type ResolvedOverrideTarget, resolveOverride } from './overrides.ts';
import { matchesRange } from './semver.ts';

/** Minimal pinned-package view the applier needs. */
export interface ShimTargetPackage {
  readonly name: string;
  readonly version: string;
  /** Project-root-relative install path; absent → flat `node_modules/<name>`. */
  readonly installPath?: string;
}

/** User-facing name a shim substitutes (`esbuild` for the wasi-preview1 alias). */
function publicName(name: string, shim: InternalsShim): string {
  return shim.into ?? name;
}

export interface EffectivePackageRequest {
  readonly override: ResolvedOverrideTarget | null;
  readonly effectiveName: string;
  readonly effectiveRange: string | null;
}

/**
 * One override/request authority for live resolve and replay.
 * Baked aliases preserve the caller's semver contract; explicit user overrides
 * intentionally replace it and therefore own the effective target range.
 */
export function resolveEffectivePackageRequest(
  name: string,
  range: string | null,
  parent: string | undefined,
  userOverrides: OverrideMap | undefined,
): EffectivePackageRequest {
  const override = resolveOverride(name, parent, userOverrides);
  const effectiveName = override?.name ?? name;
  const effectiveRange = override?.range ?? range;
  return { override, effectiveName, effectiveRange };
}

/**
 * Loud range gate: a version of a shimmed package outside the proven range
 * must never get a stale shim silently (backlog contract). No-op for
 * packages without a registered shim.
 */
export function assertShimSupported(name: string, version: string): void {
  const shim = internalsShims[name];
  if (!shim || matchesRange(version, shim.range)) return;
  throw new NotImplementedError(
    `shadow-registry.${publicName(name, shim)}@${version}`,
    `internals shim is proven for ${name}@${shim.range} only — see docs/public/compat/incompatible-packages.md`,
  );
}

/**
 * Companion requests a shimmed package needs installed alongside, pinned to
 * EXACTLY the trigger's version (the rollup ↔ @rollup/wasm-node AST buffer
 * layout is version-coupled). The dep walk injects these as extra visits;
 * they are NOT persisted as lockfile dep edges — replay re-derives them from
 * (name, version), keeping the lockfile format unchanged (ADR-0188).
 */
export function companionRequestsFor(name: string, version: string): Record<string, string> {
  const shim = internalsShims[name];
  if (!shim?.companions?.length) return {};
  assertShimSupported(name, version);
  const out: Record<string, string> = {};
  for (const companion of shim.companions) out[companion] = version;
  return out;
}

/** Alias placement: same `node_modules` scope as the trigger, under `into`. */
function aliasInstallPath(installPath: string, name: string, into: string): string {
  const suffix = `node_modules/${name}`;
  if (!installPath.endsWith(suffix)) {
    throw new Error(`Invalid installPath for ${name}: ${installPath}`);
  }
  return `${installPath.slice(0, installPath.length - name.length)}${into}`;
}

const enc = new TextEncoder();

/**
 * Post-link pass: write every registered shim into its pinned copy's install
 * dir (alias shims into the sibling dir named `into`), verify companion
 * lockstep, and report one provenance line per applied shim. Deterministic
 * function of the pinned set — replay reproduces byte-identical files.
 */
export async function applyInternalsShims(
  vfs: Vfs,
  cwd: string,
  packages: readonly ShimTargetPackage[],
  report: (line: string) => void,
): Promise<void> {
  const installedVersions = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const versions = installedVersions.get(pkg.name) ?? new Set<string>();
    versions.add(pkg.version);
    installedVersions.set(pkg.name, versions);
  }

  for (const pkg of packages) {
    const shim = internalsShims[pkg.name];
    if (!shim) continue;
    assertShimSupported(pkg.name, pkg.version);
    for (const companion of shim.companions ?? []) {
      // Fresh installs pin this by construction (the walk injects it); only a
      // replayed lockfile can drift. Loud, per "authoritative or error".
      if (!installedVersions.get(companion)?.has(pkg.version)) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: shadow-registry companion ${companion}@${pkg.version} required by ${pkg.name}@${pkg.version} is not in the installed set (lockfile predates install-time shims or drifted). Delete package-lock.json and re-install.`,
          ),
          { code: 'EBROKENLOCK', packageName: companion, reason: 'companion-drift' as const },
        );
      }
    }

    const installPath = pkg.installPath ?? `node_modules/${pkg.name}`;
    const targetRel = shim.into ? aliasInstallPath(installPath, pkg.name, shim.into) : installPath;
    for (const [rel, content] of Object.entries(shim.files)) {
      const fullPath = joinPath(cwd, `${targetRel}/${rel}`);
      await vfs.mkdir(fullPath.slice(0, fullPath.lastIndexOf('/')), { recursive: true });
      await vfs.writeFile(fullPath, enc.encode(content));
    }
    report(
      `npm: ${publicName(pkg.name, shim)}@${pkg.version} internals patched from shadow registry`,
    );
  }
}
