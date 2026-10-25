/** Catalog-owned tree copies, claims and durability; no catalog state. */
import { dirname } from '@riftydev/vfs';
import type { InstallStampClaimIo } from '../glue/install-stamp-authority.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

const INSTALL_CLAIM_NAME = '.rifty-install-stamp.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface TreeImageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface TreeImage {
  readonly directories: readonly string[];
  readonly files: readonly TreeImageFile[];
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function pathDepth(path: string): number {
  return path === '' ? 0 : path.split('/').length;
}

export function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new TypeError(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readJson(authority: OwnerVfsAuthority, path: string, label: string): unknown {
  return parseJsonBytes(authority.readFileBytesSync(path), label);
}

function ensureParent(authority: OwnerVfsAuthority, path: string): void {
  authority.mkdirSync(dirname(path), { recursive: true });
}

export function writeJson(authority: OwnerVfsAuthority, path: string, value: unknown): void {
  ensureParent(authority, path);
  authority.writeFileSync(path, jsonBytes(value));
}

export function isDirectory(authority: OwnerVfsAuthority, path: string): boolean {
  return authority.statSyncOrNull(path)?.isDirectory === true;
}

export function isFile(authority: OwnerVfsAuthority, path: string): boolean {
  return authority.statSyncOrNull(path)?.isFile === true;
}

export function captureTree(
  authority: OwnerVfsAuthority,
  root: string,
  include: (relativePath: string, kind: 'file' | 'directory') => boolean = () => true,
): TreeImage | null {
  const rootStat = authority.statSyncOrNull(root);
  if (rootStat === null) return null;
  if (!rootStat.isDirectory) throw new TypeError(`Managed tree is not a directory: ${root}`);
  const directories = new Set<string>(['']);
  const files: TreeImageFile[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    const children = [...authority.readdirSync(directory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    for (const child of children) {
      const path = `${directory}/${child.name}`;
      const relative = relativeDirectory === '' ? child.name : `${relativeDirectory}/${child.name}`;
      if (child.isDirectory) {
        if (!include(relative, 'directory')) continue;
        directories.add(relative);
        walk(path, relative);
      } else if (include(relative, 'file')) {
        files.push(
          Object.freeze({
            path: relative,
            bytes: authority.readFileBytesSync(path).slice(),
          }),
        );
      }
    }
  };
  walk(root, '');
  return Object.freeze({
    directories: Object.freeze(
      [...directories].sort(
        (left, right) => pathDepth(left) - pathDepth(right) || compareCodeUnits(left, right),
      ),
    ),
    files: Object.freeze(files.sort((left, right) => compareCodeUnits(left.path, right.path))),
  });
}

function claimRootForRelative(root: string, relative: string): string {
  const absolute = `${root}/${relative}`;
  return dirname(dirname(absolute));
}

export function isInstallClaimRelative(relative: string): boolean {
  const segments = relative.split('/');
  return segments.at(-1) === INSTALL_CLAIM_NAME && segments.at(-2) === 'node_modules';
}

function removeClaims(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  if (!isDirectory(authority, root)) return;
  const claimRoots: string[] = [];
  const walk = (directory: string): void => {
    for (const child of authority.readdirSync(directory)) {
      const path = `${directory}/${child.name}`;
      if (child.name === INSTALL_CLAIM_NAME && directory.split('/').at(-1) === 'node_modules') {
        claimRoots.push(dirname(directory));
      } else if (child.isDirectory) walk(path);
    }
  };
  walk(root);
  claimRoots.sort((left, right) => pathDepth(right) - pathDepth(left));
  for (const claimRoot of claimRoots) claims.remove(claimRoot);
}

export function removeManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  removeClaims(authority, claims, root);
  authority.rmSync(root, { recursive: true, force: true });
}

export function applyTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
  image: TreeImage | null,
): void {
  removeManagedTree(authority, claims, root);
  if (image === null) return;
  authority.mkdirSync(root, { recursive: true });
  for (const relative of image.directories) {
    if (relative !== '') authority.mkdirSync(`${root}/${relative}`, { recursive: true });
  }
  for (const file of image.files) {
    const target = `${root}/${file.path}`;
    const bytes = new Uint8Array(file.bytes);
    if (isInstallClaimRelative(file.path)) {
      claims.write(claimRootForRelative(root, file.path), bytes, { mkdirTree: true });
    } else {
      authority.mkdirSync(dirname(target), { recursive: true });
      authority.writeFileSync(target, bytes);
    }
  }
}

export function legacyTree(
  authority: OwnerVfsAuthority,
  sourceRoot: string,
  preserveDependencies = false,
): TreeImage {
  const source = captureTree(authority, sourceRoot, (relative, kind) => {
    const segments = relative.split('/');
    if (segments[0] === '.rifty') return false;
    if (!preserveDependencies && segments.includes('node_modules')) return false;
    if (kind === 'file' && isInstallClaimRelative(relative)) return false;
    return true;
  });
  if (source === null) throw new TypeError(`Legacy migration source is missing: ${sourceRoot}`);
  const retainedDirectories = new Set<string>(preserveDependencies ? source.directories : ['']);
  for (const file of source.files) {
    let parent = dirname(file.path);
    while (parent !== '.' && parent !== '') {
      retainedDirectories.add(parent);
      parent = dirname(parent);
    }
  }
  return Object.freeze({
    directories: Object.freeze(
      [
        ...new Set([
          '',
          'tree',
          ...[...retainedDirectories].map((path) => (path ? `tree/${path}` : 'tree')),
        ]),
      ].sort((left, right) => pathDepth(left) - pathDepth(right) || compareCodeUnits(left, right)),
    ),
    files: Object.freeze(
      source.files.map((file) => Object.freeze({ path: `tree/${file.path}`, bytes: file.bytes })),
    ),
  });
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function imageMatches(
  authority: OwnerVfsAuthority,
  root: string,
  expected: TreeImage,
  allowSubset: boolean,
): boolean {
  const actual = captureTree(authority, root);
  if (actual === null) return false;
  const expectedDirs = new Set(expected.directories);
  const expectedFiles = new Map(
    expected.files.map((file) => [file.path, new Uint8Array(file.bytes)]),
  );
  if (actual.directories.some((path) => !expectedDirs.has(path))) return false;
  for (const file of actual.files) {
    const bytes = expectedFiles.get(file.path);
    if (bytes === undefined || !bytesEqual(new Uint8Array(file.bytes), bytes)) return false;
  }
  if (allowSubset) return true;
  return (
    actual.directories.length === expected.directories.length &&
    actual.files.length === expected.files.length
  );
}

export async function flushRequired(authority: OwnerVfsAuthority): Promise<void> {
  const report = await authority.flush();
  if (report !== undefined && report.total > 0) {
    const sample = report.failures[0]?.message;
    throw new Error(
      `${String(report.total)} unhealed persistence failure(s)${sample ? `: ${sample}` : ''}`,
    );
  }
}

export async function durableWriteJson(
  authority: OwnerVfsAuthority,
  path: string,
  value: unknown,
): Promise<void> {
  const parent = dirname(path);
  if (!isDirectory(authority, parent)) {
    authority.mkdirSync(parent, { recursive: true });
    await flushRequired(authority);
  }
  authority.writeFileSync(path, jsonBytes(value));
  await flushRequired(authority);
}

export async function durableRemove(authority: OwnerVfsAuthority, path: string): Promise<void> {
  if (authority.statSyncOrNull(path) === null) return;
  authority.rmSync(path, { recursive: true, force: true });
  await flushRequired(authority);
}

export async function applyTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
  image: TreeImage | null,
): Promise<void> {
  if (authority.statSyncOrNull(root) !== null) {
    removeManagedTree(authority, claims, root);
  }
  if (image === null) {
    await flushRequired(authority);
    return;
  }
  const orderedImageDirectories = [...image.directories]
    .filter((relative) => relative !== '')
    .sort((left, right) => pathDepth(right) - pathDepth(left) || compareCodeUnits(left, right));
  for (const relative of orderedImageDirectories) {
    const directory = `${root}/${relative}`;
    if (!isDirectory(authority, directory)) {
      authority.mkdirSync(directory, { recursive: true });
    }
  }
  if (!isDirectory(authority, root)) authority.mkdirSync(root, { recursive: true });
  await flushRequired(authority);
  for (const file of image.files) {
    const target = `${root}/${file.path}`;
    const bytes = new Uint8Array(file.bytes);
    if (isInstallClaimRelative(file.path)) {
      claims.write(claimRootForRelative(root, file.path), bytes, { mkdirTree: true });
    } else {
      authority.writeFileSync(target, bytes);
    }
  }
  if (image.files.length > 0) await flushRequired(authority);
}

export async function removeManagedTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): Promise<void> {
  if (authority.statSyncOrNull(root) === null) return;
  removeManagedTree(authority, claims, root);
  await flushRequired(authority);
}

export function tombstoneManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  if (authority.statSyncOrNull(root) === null) {
    authority.mkdirSync(root, { recursive: true });
  }
  removeManagedTree(authority, claims, root);
}

interface ManagedCopyPlanFile {
  readonly sourcePath: string;
  readonly relative: string;
  readonly claim: boolean;
}

interface ManagedCopyPlan {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly directories: readonly string[];
  readonly files: readonly ManagedCopyPlanFile[];
}

function planManagedTreeCopy(
  authority: OwnerVfsAuthority,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): ManagedCopyPlan {
  const source = authority.statSyncOrNull(sourceRoot);
  if (source === null || !source.isDirectory) {
    throw new TypeError(`Managed copy source is not a directory: ${sourceRoot}`);
  }
  if (authority.statSyncOrNull(targetRoot) !== null) {
    throw new TypeError(`Managed copy target already exists: ${targetRoot}`);
  }
  const include = options.include ?? (() => true);
  const directories: string[] = [];
  const files: ManagedCopyPlanFile[] = [];
  const walk = (sourceDirectory: string, relativeDirectory: string): void => {
    const children = [...authority.readdirSync(sourceDirectory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    for (const child of children) {
      const sourcePath = `${sourceDirectory}/${child.name}`;
      const relative = relativeDirectory === '' ? child.name : `${relativeDirectory}/${child.name}`;
      if (child.isDirectory) {
        if (!include(relative, 'directory')) continue;
        directories.push(relative);
        walk(sourcePath, relative);
        continue;
      }
      if (!include(relative, 'file')) continue;
      if (isInstallClaimRelative(relative)) {
        if (!options.copyClaims) continue;
        files.push(Object.freeze({ sourcePath, relative, claim: true }));
      } else {
        files.push(Object.freeze({ sourcePath, relative, claim: false }));
      }
    }
  };
  walk(sourceRoot, '');
  return Object.freeze({
    sourceRoot,
    targetRoot,
    directories: Object.freeze(directories),
    files: Object.freeze(files),
  });
}

function applyManagedCopyDirectories(authority: OwnerVfsAuthority, plan: ManagedCopyPlan): void {
  for (const relative of [...plan.directories].sort(
    (left, right) => pathDepth(right) - pathDepth(left) || compareCodeUnits(left, right),
  )) {
    const target = `${plan.targetRoot}/${relative}`;
    if (!isDirectory(authority, target)) authority.mkdirSync(target, { recursive: true });
  }
  if (!isDirectory(authority, plan.targetRoot)) {
    authority.mkdirSync(plan.targetRoot, { recursive: true });
  }
}

function applyManagedCopyFiles(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  plan: ManagedCopyPlan,
): void {
  for (const file of plan.files) {
    if (file.claim) {
      const sourceClaimRoot = claimRootForRelative(plan.sourceRoot, file.relative);
      const claim = claims.read(sourceClaimRoot);
      if (claim === null) {
        throw new TypeError(`Managed install claim disappeared: ${sourceClaimRoot}`);
      }
      claims.write(claimRootForRelative(plan.targetRoot, file.relative), claim, {
        mkdirTree: true,
      });
    } else {
      authority.copyFileSync(file.sourcePath, `${plan.targetRoot}/${file.relative}`);
    }
  }
}

export function copyManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): void {
  const plan = planManagedTreeCopy(authority, sourceRoot, targetRoot, options);
  applyManagedCopyDirectories(authority, plan);
  applyManagedCopyFiles(authority, claims, plan);
}

export async function copyManagedTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): Promise<void> {
  const plan = planManagedTreeCopy(authority, sourceRoot, targetRoot, options);
  applyManagedCopyDirectories(authority, plan);
  await flushRequired(authority);
  applyManagedCopyFiles(authority, claims, plan);
  if (plan.files.length > 0) await flushRequired(authority);
}
