/**
 * Install stamp (ADR-0135): `<root>/node_modules/.rifty-install-stamp.json`
 * marks "this node_modules was installed for project SLUG". The worker bootstrap
 * skips its `install()` when the stamp's slug matches the project being booted —
 * that skip is what makes a re-opened project fast.
 *
 * Reuse key = the project SLUG (preset id), NOT the dep set: two projects can
 * share dependencies (e.g. `project-files` and `real-vite` both run `vite`) yet
 * must not reuse each other's tree — otherwise a from-scratch preset would skip
 * the very install it exists to show. package.json deps are kept as a secondary
 * freshness guard.
 *
 * Trust model: the stamp trusts the tree wholesale — no per-file verification.
 * Durability ordering (ADR-0187 Corrected): trusted stamps mean durable tree.
 * Every transition is owned by `install-stamp-authority.ts`; pending stamps
 * never satisfy reuse and are promoted only after a clean durability proof.
 */
// TODO(backlog: playground/install-stamp-invalidation)
import {
  type PersistFailureReport,
  type Vfs,
  isAbsolute,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import { installArtifactIdentity } from './install-artifact-identity.ts';

export interface InstallStamp {
  readonly version: 4;
  /** Canonical absolute project root this claim was minted for. */
  readonly root: string;
  /** Project identity (preset slug) the tree was installed for — the reuse key. */
  readonly slug: string;
  /** Exact request bytes that produced the tree; never a flattened projection. */
  readonly packageJsonText: string;
  /** Exact installer/shim/generated-runtime policy that produced the tree. */
  readonly installArtifactIdentity: string;
  /** ADR-0307: sha256 hex over the exact `package-lock.json` bytes at trust
   * time; absent iff no lockfile existed then. Compared at open — drift is a
   * miss that runs real arrival. */
  readonly lockfileSha256?: string;
  /** package.json effective request: dependencies ∪ devDependencies ∪
   *  optionalDependencies (secondary freshness guard alongside the slug). */
  readonly deps: Readonly<Record<string, string>>;
  /** `result.packages.length` of the install that produced the tree. */
  readonly packages: number;
  /** Pending boot/restore stamps are visible for diagnostics but never trusted. */
  readonly durability?: 'pending';
  /** Authority-issued per-claim fence; present only while pending. */
  readonly epoch?: string;
}

/** The dependency tree the stamp attests durable: `<root>/node_modules`. The
 * stamp trusts THIS subtree wholesale — so only persist failures UNDER it mean
 * the stamped tree is torn. A global/foreign path failing to persist (e.g.
 * `/.rifty/eddy-learned-pins.json`, another project's tree) must NOT gate or
 * revoke this project's stamp. */
export function installTreeDir(root: string): string {
  return joinPath(root, 'node_modules');
}

export const INSTALL_STAMP_BASENAME = '.rifty-install-stamp.json';

export function lockfilePath(root: string): string {
  return joinPath(root, 'package-lock.json');
}

const LOCKFILE_SHA256_RE = /^[0-9a-f]{64}$/;

/** ADR-0307 at-open compare: absent hash requires absent lockfile; a recorded
 * hash requires the exact current bytes. Sync so every realm (owner boot gate,
 * sync check, async predicates) applies the SAME compare — webcrypto would
 * fork the sync realms onto a weaker existence-only check. */
export function lockfileMatchesStamp(
  stamp: InstallStamp,
  currentBytes: Uint8Array | null,
): boolean {
  if (stamp.lockfileSha256 === undefined) return currentBytes === null;
  if (currentBytes === null) return false;
  return sha256Hex(currentBytes) === stamp.lockfileSha256;
}

// TODO(backlog: npm-client/package-tree-authority) Consolidate the one-shot SHA core.
// FIPS 180-4 SHA-256; same implementation as the tool-local
// esbuild-contract-probe copy (browser-safe, no node:crypto). Fixed-vector
// guarded in install-stamp.test.ts against `crypto.subtle`.
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(value: string | Uint8Array): string {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const bitLength = input.byteLength * 8;
  const byteLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(byteLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(byteLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(byteLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function installStampPath(root: string): string {
  return joinPath(installTreeDir(root), INSTALL_STAMP_BASENAME);
}

/** True for a reserved claim location or anything structurally below it. */
export function isInstallStampPath(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const normalized = normalizePath(path);
  const suffix = `/node_modules/${INSTALL_STAMP_BASENAME}`;
  return normalized === suffix || normalized.endsWith(suffix) || normalized.includes(`${suffix}/`);
}

/** ADR-0307: true iff `path` is STRICTLY below a `node_modules` segment at any
 * depth — an extraneous-write location that never affects claims or Scratch
 * dirty. The tree directory itself (last segment `node_modules`) is not
 * "inside": destroying/moving it stays a tree mutation. */
export function isInsideInstallTree(path: string): boolean {
  const segments = normalizePath(path).split('/').filter(Boolean);
  const index = segments.indexOf('node_modules');
  return index !== -1 && index < segments.length - 1;
}

/** True iff `path` is inside the stamped tree AND is not the stamp file itself
 * (a stamp-file failure is not a torn TREE: no stamp on disk simply re-runs
 * arrival; a stamp about to be rewritten heals). */
export function isStampedTreeDamage(path: string, root: string): boolean {
  if (path === installStampPath(root)) return false;
  const dir = installTreeDir(root);
  return path === dir || path.startsWith(`${dir}/`);
}

/** Ask a {@link PersistFailureReport} whether ANY unhealed path matches, over
 * the FULL ledger when the backend can answer it (`anyFailure`), else the
 * SAMPLE. A durability gate must use this, never scan `report.failures`
 * directly: the sample truncates at PERSIST_REPORT_SAMPLE, so a torn-tree path
 * beyond it would be missed and the stamp would trust a broken tree. */
export function reportHasFailure(
  report: PersistFailureReport,
  predicate: (path: string) => boolean,
): boolean {
  return report.anyFailure
    ? report.anyFailure(predicate)
    : report.failures.some((failure) => predicate(failure.path));
}

function readExactStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    return null;
  }
  return Object.fromEntries(entries);
}

export function effectiveDepsFromPackageJsonText(text: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const dependencies = raw.dependencies === undefined ? {} : readExactStringMap(raw.dependencies);
  const devDependencies =
    raw.devDependencies === undefined ? {} : readExactStringMap(raw.devDependencies);
  const optionalDependencies =
    raw.optionalDependencies === undefined ? {} : readExactStringMap(raw.optionalDependencies);
  if (!dependencies || !devDependencies || !optionalDependencies) return null;
  return {
    ...dependencies,
    ...devDependencies,
    ...optionalDependencies,
  };
}

/**
 * The dep set an `install({vfs, cwd})` call would request for this project,
 * or `null` when package.json is missing/malformed (then nothing can be
 * stamped or matched).
 */
export async function readEffectiveDeps(
  vfs: Vfs,
  root: string,
): Promise<Record<string, string> | null> {
  const text = await readPackageJsonText(vfs, root);
  return text === null ? null : effectiveDepsFromPackageJsonText(text);
}

export async function readPackageJsonText(vfs: Vfs, root: string): Promise<string | null> {
  const path = joinPath(root, 'package.json');
  if (!(await vfs.exists(path))) return null;
  try {
    return await vfs.readFileText(path);
  } catch {
    return null;
  }
}

export function depsEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export interface InstallStampPayload {
  readonly slug: string;
  readonly packages: number;
  readonly lockfileSha256?: string;
  readonly durability?: 'pending';
  readonly epoch?: string;
}

/** One constructor for every async/sync stamp writer. */
export function createInstallStamp(
  root: string,
  packageJsonText: string,
  payload: InstallStampPayload,
): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  if (!Number.isSafeInteger(payload.packages) || payload.packages < 0) return null;
  const canonicalRoot = normalizePath(root);
  const deps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!deps) return null;
  if (payload.lockfileSha256 !== undefined && !LOCKFILE_SHA256_RE.test(payload.lockfileSha256)) {
    return null;
  }
  const stamp = {
    version: 4,
    root: canonicalRoot,
    slug: payload.slug,
    packageJsonText,
    installArtifactIdentity,
    ...(payload.lockfileSha256 === undefined ? {} : { lockfileSha256: payload.lockfileSha256 }),
    deps,
    packages: payload.packages,
  } satisfies Omit<InstallStamp, 'durability' | 'epoch'>;
  if (payload.durability === 'pending') {
    if (typeof payload.epoch !== 'string' || payload.epoch.length === 0) return null;
    return { ...stamp, durability: 'pending', epoch: payload.epoch };
  }
  if (payload.epoch !== undefined) return null;
  return stamp;
}

/** One parser for async and sync readers. Legacy/malformed claims are misses. */
export function parseInstallStamp(value: unknown, root: string): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const canonicalRoot = normalizePath(root);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as {
    version?: unknown;
    root?: unknown;
    slug?: unknown;
    packageJsonText?: unknown;
    installArtifactIdentity?: unknown;
    lockfileSha256?: unknown;
    deps?: unknown;
    packages?: unknown;
    durability?: unknown;
    epoch?: unknown;
  };
  if (
    raw.version !== 4 ||
    typeof raw.root !== 'string' ||
    !isAbsolute(raw.root) ||
    normalizePath(raw.root) !== raw.root ||
    raw.root !== canonicalRoot ||
    typeof raw.slug !== 'string' ||
    typeof raw.packageJsonText !== 'string' ||
    typeof raw.installArtifactIdentity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(raw.installArtifactIdentity) ||
    typeof raw.packages !== 'number' ||
    !Number.isSafeInteger(raw.packages) ||
    raw.packages < 0
  ) {
    return null;
  }
  if (raw.lockfileSha256 !== undefined) {
    if (typeof raw.lockfileSha256 !== 'string' || !LOCKFILE_SHA256_RE.test(raw.lockfileSha256)) {
      return null;
    }
  }
  const exactDeps = effectiveDepsFromPackageJsonText(raw.packageJsonText);
  const deps = readExactStringMap(raw.deps);
  if (!exactDeps || !deps) return null;
  if (!depsEqual(deps, exactDeps)) return null;
  if (raw.durability !== undefined && raw.durability !== 'pending') return null;
  if (
    raw.durability === 'pending'
      ? typeof raw.epoch !== 'string' || raw.epoch.length === 0
      : raw.epoch !== undefined
  ) {
    return null;
  }
  return {
    version: 4,
    root: raw.root,
    slug: raw.slug,
    packageJsonText: raw.packageJsonText,
    installArtifactIdentity: raw.installArtifactIdentity,
    ...(typeof raw.lockfileSha256 === 'string' ? { lockfileSha256: raw.lockfileSha256 } : {}),
    deps,
    packages: raw.packages,
    ...(raw.durability === 'pending' ? { durability: 'pending' as const } : {}),
    ...(typeof raw.epoch === 'string' ? { epoch: raw.epoch } : {}),
  };
}

function depsInclude(
  full: Readonly<Record<string, string>>,
  subset: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(subset).every(([key, value]) => full[key] === value);
}

export async function readInstallStamp(vfs: Vfs, root: string): Promise<InstallStamp | null> {
  if (!isAbsolute(root)) return null;
  const path = installStampPath(root);
  if (!(await vfs.exists(path))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vfs.readFileText(path));
  } catch {
    return null;
  }
  return parseInstallStamp(parsed, root);
}

export function stampTrusted(stamp: InstallStamp): boolean {
  return (
    stamp.durability !== 'pending' && stamp.installArtifactIdentity === installArtifactIdentity
  );
}

/**
 * The skip predicate: stamp present, its slug matches the project being booted,
 * `node_modules/` exists, and deps still match package.json (freshness guard).
 * Returns the stamp (for its package count) or null.
 */
export async function installStampSatisfied(
  vfs: Vfs,
  root: string,
  slug = '',
): Promise<InstallStamp | null> {
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  const packageJsonText = await readPackageJsonText(vfs, root);
  if (packageJsonText === null || stamp.packageJsonText !== packageJsonText) return null;
  if (!lockfileMatchesStamp(stamp, await readLockfileBytes(vfs, root))) return null;
  return stamp;
}

async function readLockfileBytes(vfs: Vfs, root: string): Promise<Uint8Array | null> {
  const path = lockfilePath(root);
  if (!(await vfs.exists(path))) return null;
  try {
    return await vfs.readFile(path);
  } catch {
    return null;
  }
}

/**
 * Same skip predicate as installStampSatisfied, but the caller also provides the
 * template package.json that is about to boot. This prevents a same-root starter
 * switch from reusing a stamp that only matches the previous package.json still
 * on disk.
 */
export async function installStampSatisfiedForPackageJson(
  vfs: Vfs,
  root: string,
  slug: string,
  packageJsonText: string,
): Promise<InstallStamp | null> {
  if (!isAbsolute(root)) return null;
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentText = await readPackageJsonText(vfs, root);
  if (currentText === null) return null;
  const currentDeps = effectiveDepsFromPackageJsonText(currentText);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  if (stamp.packageJsonText !== currentText) return null;
  if (!lockfileMatchesStamp(stamp, await readLockfileBytes(vfs, root))) return null;
  return stamp;
}

/** The sync fs slice the SYNC stamp predicate reads through. */
export interface InstallStampSyncFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
}

const stampDecoder = new TextDecoder('utf-8');

/**
 * Sync twin of {@link installStampSatisfiedForPackageJson} over the sync
 * mirror. Exists for the owner-boot eddy prefetch gate (ADR-0195): an ASYNC
 * gate starves behind the owner's busy boot loop, so the prefetch used to fire
 * AFTER the install it was meant to feed — a sync gate lets the fetch start
 * before any boot work blocks the realm.
 */
export function installStampSatisfiedForPackageJsonSync(
  fs: InstallStampSyncFs,
  root: string,
  slug: string,
  packageJsonText: string,
): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentText = readTextSyncOrNull(fs, joinPath(root, 'package.json'));
  if (currentText === null) return null;
  const currentDeps = effectiveDepsFromPackageJsonText(currentText);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = readInstallStampSync(fs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!fs.existsSync(joinPath(root, 'node_modules'))) return null;
  if (stamp.packageJsonText !== currentText) return null;
  if (!lockfileMatchesStamp(stamp, readBytesSyncOrNull(fs, lockfilePath(root)))) return null;
  return stamp;
}

function readBytesSyncOrNull(fs: InstallStampSyncFs, path: string): Uint8Array | null {
  if (!fs.existsSync(path)) return null;
  try {
    return fs.readFileBytesSync(path);
  } catch {
    return null;
  }
}

function readTextSyncOrNull(fs: InstallStampSyncFs, path: string): string | null {
  if (!fs.existsSync(path)) return null;
  try {
    return stampDecoder.decode(fs.readFileBytesSync(path));
  } catch {
    return null;
  }
}

/** Sync twin of {@link readInstallStamp} — exported for write-site rechecks
 * that must be ATOMIC with a sync write (no await between read and write). */
export function readInstallStampSync(fs: InstallStampSyncFs, root: string): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const text = readTextSyncOrNull(fs, installStampPath(root));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseInstallStamp(parsed, root);
}
