/** Read-only claim, manifest/lock and durability-report classification (ADR-0261). */
import { type FsSync, type PersistFailureReport, type Vfs, joinPath } from '@riftydev/vfs';
import {
  type InstallStamp,
  effectiveDepsFromPackageJsonText,
  installStampPath,
  installTreeDir,
  isStampedTreeDamage,
  lockfileMatchesStamp,
  lockfilePath,
  parseInstallStamp,
  readInstallStamp,
  reportHasFailure,
  stampTrusted,
} from './install-stamp.ts';

export interface InstallStampCheckInput {
  readonly root: string;
  readonly slug?: string;
  /** Template request which the current exact package.json must cover. */
  readonly expectedPackageJsonText?: string;
}

export type InstallStampCheck =
  | { readonly status: 'absent' }
  | { readonly status: 'pending'; readonly stamp?: InstallStamp }
  | { readonly status: 'trusted'; readonly stamp: InstallStamp };

export interface StampReadIo {
  readonly vfs: Vfs;
  readonly fsSync?: Pick<FsSync, 'existsSync' | 'readFileBytesSync'> &
    Partial<Pick<FsSync, 'statSync'>>;
  readonly claimIo?: { read(root: string): Uint8Array | null };
}

type StampReadFs = NonNullable<StampReadIo['fsSync']>;
const dec = new TextDecoder('utf-8');

function depsInclude(
  full: Readonly<Record<string, string>>,
  subset: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(subset).every(([key, value]) => full[key] === value);
}

export async function readText(io: StampReadIo, path: string): Promise<string | null> {
  if (io.fsSync) {
    if (!io.fsSync.existsSync(path)) return null;
    try {
      return dec.decode(io.fsSync.readFileBytesSync(path));
    } catch {
      return null;
    }
  }
  if (!(await io.vfs.exists(path))) return null;
  try {
    return await io.vfs.readFileText(path);
  } catch {
    return null;
  }
}

export async function readDemotionManifest(
  io: StampReadIo,
  root: string,
  prior: InstallStamp | null,
): Promise<string | undefined> {
  const current = await readText(io, joinPath(root, 'package.json'));
  return current !== null && effectiveDepsFromPackageJsonText(current) !== null
    ? current
    : prior?.packageJsonText;
}

function readTextSync(fsSync: StampReadFs, path: string): string | null {
  if (!fsSync.existsSync(path)) return null;
  try {
    return dec.decode(fsSync.readFileBytesSync(path));
  } catch {
    return null;
  }
}

export async function readStamp(io: StampReadIo, root: string): Promise<InstallStamp | null> {
  if (io.claimIo) {
    try {
      const bytes = io.claimIo.read(root);
      if (bytes === null) return null;
      return parseInstallStamp(JSON.parse(dec.decode(bytes)), root);
    } catch {
      return null;
    }
  }
  if (!io.fsSync) return readInstallStamp(io.vfs, root);
  const text = readTextSync(io.fsSync, installStampPath(root));
  if (text === null) return null;
  try {
    return parseInstallStamp(JSON.parse(text), root);
  } catch {
    return null;
  }
}

export function readStampSync(fsSync: StampReadFs, root: string): InstallStamp | null {
  const text = readTextSync(fsSync, installStampPath(root));
  if (text === null) return null;
  try {
    return parseInstallStamp(JSON.parse(text), root);
  } catch {
    return null;
  }
}

export async function pathExists(io: StampReadIo, path: string): Promise<boolean> {
  return io.fsSync ? io.fsSync.existsSync(path) : io.vfs.exists(path);
}

export async function directoryExists(io: StampReadIo, path: string): Promise<boolean> {
  if (io.fsSync?.statSync)
    return io.fsSync.existsSync(path) && io.fsSync.statSync(path).isDirectory;
  return (await io.vfs.exists(path)) && (await io.vfs.stat(path)).isDirectory;
}

export async function readLockfileBytesIo(
  io: StampReadIo,
  root: string,
): Promise<Uint8Array | null> {
  const path = lockfilePath(root);
  try {
    if (io.fsSync) return readLockfileBytesSync(io.fsSync, root);
    return (await io.vfs.exists(path)) ? await io.vfs.readFile(path) : null;
  } catch {
    return null;
  }
}

export async function readExactFileBytes(
  io: StampReadIo,
  path: string,
): Promise<Uint8Array | null> {
  if (io.fsSync) {
    return io.fsSync.existsSync(path) ? io.fsSync.readFileBytesSync(path) : null;
  }
  return (await io.vfs.exists(path)) ? io.vfs.readFile(path) : null;
}

function readLockfileBytesSync(
  fsSync: Pick<StampReadFs, 'existsSync' | 'readFileBytesSync'>,
  root: string,
): Uint8Array | null {
  const path = lockfilePath(root);
  try {
    return fsSync.existsSync(path) ? fsSync.readFileBytesSync(path) : null;
  } catch {
    return null;
  }
}

export async function classifyCheck(
  io: StampReadIo,
  input: InstallStampCheckInput,
): Promise<{
  readonly result: InstallStampCheck;
  readonly diskPhase: InstallStampCheck['status'];
  readonly stamp: InstallStamp | null;
}> {
  const stamp = await readStamp(io, input.root);
  if (!stamp) return { result: { status: 'absent' }, diskPhase: 'absent', stamp: null };
  if (!stampTrusted(stamp)) {
    const result: InstallStampCheck =
      input.slug === undefined || input.slug === stamp.slug
        ? { status: 'pending', stamp }
        : { status: 'absent' };
    return { result, diskPhase: 'pending', stamp };
  }
  const currentText = await readText(io, joinPath(input.root, 'package.json'));
  const treeExists = await pathExists(io, installTreeDir(input.root));
  let expectedCovered = true;
  if (input.expectedPackageJsonText !== undefined) {
    const expected = effectiveDepsFromPackageJsonText(input.expectedPackageJsonText);
    const current = currentText === null ? null : effectiveDepsFromPackageJsonText(currentText);
    expectedCovered = expected !== null && current !== null && depsInclude(current, expected);
  }
  const lockfileOk = lockfileMatchesStamp(stamp, await readLockfileBytesIo(io, input.root));
  const matches =
    (input.slug === undefined || input.slug === stamp.slug) &&
    treeExists &&
    currentText !== null &&
    stamp.packageJsonText === currentText &&
    lockfileOk &&
    expectedCovered;
  return {
    result: matches ? { status: 'trusted', stamp } : { status: 'absent' },
    diskPhase: 'trusted',
    stamp,
  };
}

export function classifyCheckSync(
  fsSync: StampReadFs,
  input: InstallStampCheckInput,
): {
  readonly result: InstallStampCheck;
  readonly diskPhase: InstallStampCheck['status'];
  readonly stamp: InstallStamp | null;
} {
  const stamp = readStampSync(fsSync, input.root);
  if (!stamp) return { result: { status: 'absent' }, diskPhase: 'absent', stamp: null };
  if (!stampTrusted(stamp)) {
    const result: InstallStampCheck =
      input.slug === undefined || input.slug === stamp.slug
        ? { status: 'pending', stamp }
        : { status: 'absent' };
    return { result, diskPhase: 'pending', stamp };
  }
  const currentText = readTextSync(fsSync, joinPath(input.root, 'package.json'));
  let expectedCovered = true;
  if (input.expectedPackageJsonText !== undefined) {
    const expected = effectiveDepsFromPackageJsonText(input.expectedPackageJsonText);
    const current = currentText === null ? null : effectiveDepsFromPackageJsonText(currentText);
    expectedCovered = expected !== null && current !== null && depsInclude(current, expected);
  }
  const matches =
    (input.slug === undefined || input.slug === stamp.slug) &&
    fsSync.existsSync(installTreeDir(input.root)) &&
    currentText !== null &&
    stamp.packageJsonText === currentText &&
    lockfileMatchesStamp(stamp, readLockfileBytesSync(fsSync, input.root)) &&
    expectedCovered;
  return {
    result: matches ? { status: 'trusted', stamp } : { status: 'absent' },
    diskPhase: 'trusted',
    stamp,
  };
}

export async function readRawClaim(io: StampReadIo, root: string): Promise<Uint8Array | null> {
  const bytes = io.claimIo
    ? io.claimIo.read(root)
    : await readExactFileBytes(io, installStampPath(root));
  return bytes === null ? null : bytes.slice();
}

export function decodeRawClaim(bytes: Uint8Array | null, root: string): InstallStamp | null {
  if (bytes === null) return null;
  try {
    return parseInstallStamp(JSON.parse(dec.decode(bytes)), root);
  } catch {
    return null;
  }
}

function failureAt(
  report: PersistFailureReport | undefined,
  predicate: (path: string) => boolean,
): boolean {
  return report !== undefined && reportHasFailure(report, predicate);
}

export function guardedScopeFailed(
  report: PersistFailureReport | undefined,
  root: string,
): boolean {
  return failureAt(report, (path) => isStampedTreeDamage(path, root));
}

export function claimFailed(report: PersistFailureReport | undefined, root: string): boolean {
  const path = installStampPath(root);
  return failureAt(report, (candidate) => candidate === path);
}
