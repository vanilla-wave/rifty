import { type FsSync, NotImplementedError, joinPath, normalizePath } from '@riftydev/vfs';
import {
  type ViteConfigTempPatchSource,
  viteConfigTempPatchPolicy,
} from './vite-config-temp-patch-policy.ts';

export { viteConfigTempPatchPolicy };

const decoder = new TextDecoder('utf-8', { fatal: true });

type ReadFs = Pick<FsSync, 'statSyncOrNull' | 'readdirSync' | 'readFileBytesSync'>;
type WriteFs = ReadFs & Pick<FsSync, 'writeFileSync'>;

export interface PreparedViteConfigSource {
  readonly relativeSourcePath: string;
  readonly sourceBytes: Uint8Array;
}

interface LocatedViteConfigSource {
  readonly policy: ViteConfigTempPatchSource;
  readonly absoluteSourcePath: string;
  readonly sourceBytes: Uint8Array;
  readonly source: string;
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

export function viteConfigTempNotImplemented(reason: string): NotImplementedError {
  return new NotImplementedError(viteConfigTempPatchPolicy.feature, reason);
}

function policyForVersion(version: string): ViteConfigTempPatchSource {
  const policy = viteConfigTempPatchPolicy.sources.find((source) => source.version === version);
  if (!policy) {
    throw viteConfigTempNotImplemented(`unsupported installed Vite version: ${version}`);
  }
  return policy;
}

function decodeSource(bytes: Uint8Array, label: string): string {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    throw viteConfigTempNotImplemented(
      `${label} is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function packagePolicy(fs: ReadFs, packageRoot: string): ViteConfigTempPatchSource {
  const manifestPath = joinPath(packageRoot, 'package.json');
  if (fs.statSyncOrNull(manifestPath)?.isFile !== true) {
    throw viteConfigTempNotImplemented(`installed Vite manifest is missing: ${manifestPath}`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      decodeSource(fs.readFileBytesSync(manifestPath), manifestPath),
    ) as unknown;
  } catch (error) {
    if (error instanceof NotImplementedError) throw error;
    throw viteConfigTempNotImplemented(
      `installed Vite manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !Object.hasOwn(manifest, 'name') ||
    !Object.hasOwn(manifest, 'version') ||
    (manifest as { readonly name?: unknown }).name !== 'vite' ||
    typeof (manifest as { readonly version?: unknown }).version !== 'string'
  ) {
    throw viteConfigTempNotImplemented(`installed Vite manifest is malformed: ${manifestPath}`);
  }
  return policyForVersion((manifest as { readonly version: string }).version);
}

function allAnchorCounts(source: string): number {
  let count = 0;
  for (const policy of viteConfigTempPatchPolicy.sources) {
    count += occurrences(source, policy.upstreamBlock);
    count += occurrences(source, policy.preparedBlock);
  }
  return count;
}

function locateSource(fs: ReadFs, packageRoot: string): LocatedViteConfigSource {
  const policy = packagePolicy(fs, packageRoot);
  const chunks = joinPath(packageRoot, 'dist/node/chunks');
  if (fs.statSyncOrNull(chunks)?.isDirectory !== true) {
    throw viteConfigTempNotImplemented(`installed Vite chunks directory is missing: ${chunks}`);
  }
  const expectedPath = joinPath(packageRoot, policy.relativeSourcePath);
  let expected: LocatedViteConfigSource | undefined;
  let anchors = 0;
  for (const entry of fs.readdirSync(chunks)) {
    if (entry.isDirectory || !entry.name.endsWith('.js')) continue;
    const absoluteSourcePath = joinPath(chunks, entry.name);
    const sourceBytes = fs.readFileBytesSync(absoluteSourcePath);
    const source = decodeSource(sourceBytes, absoluteSourcePath);
    anchors += allAnchorCounts(source);
    if (absoluteSourcePath === expectedPath) {
      expected = { policy, absoluteSourcePath, sourceBytes, source };
    }
  }
  if (anchors !== 1 || expected === undefined || allAnchorCounts(expected.source) !== 1) {
    throw viteConfigTempNotImplemented(
      `expected one Vite ${policy.version} config-loader anchor at ${expectedPath}; found ${String(anchors)}`,
    );
  }
  return expected;
}

export function viteConfigTempPatchApplied(source: string, version: string): boolean {
  const policy = viteConfigTempPatchPolicy.sources.find((item) => item.version === version);
  return (
    policy !== undefined &&
    occurrences(source, policy.upstreamBlock) === 0 &&
    occurrences(source, policy.preparedBlock) === 1
  );
}

/** Redirect exactly three backing calls while retaining Vite's complete loader algorithm. */
export function applyViteConfigTempPatch(source: string, version: string): string {
  const policy = policyForVersion(version);
  const upstream = occurrences(source, policy.upstreamBlock);
  const prepared = occurrences(source, policy.preparedBlock);
  if (upstream === 0 && prepared === 1) return source;
  if (upstream === 1 && prepared === 0) {
    return source.replace(policy.upstreamBlock, policy.preparedBlock);
  }
  throw viteConfigTempNotImplemented(
    `Vite ${version} config-loader anchor drifted: expected original/prepared 1/0 or 0/1; found ${String(upstream)}/${String(prepared)}`,
  );
}

/** Acquisition-only mutation before install-claim promotion. */
export function prepareViteConfigTempSource(fs: WriteFs, vitePackageRoot: string): void {
  const located = locateSource(fs, normalizePath(vitePackageRoot));
  const prepared = applyViteConfigTempPatch(located.source, located.policy.version);
  if (prepared !== located.source) {
    fs.writeFileSync(located.absoluteSourcePath, new TextEncoder().encode(prepared));
  }
}

/** Trusted-child validation; never repairs installed bytes. */
export function validatePreparedViteConfigSource(fs: ReadFs, vitePackageRoot: string): void {
  const located = locateSource(fs, normalizePath(vitePackageRoot));
  if (!viteConfigTempPatchApplied(located.source, located.policy.version)) {
    throw viteConfigTempNotImplemented(
      `Vite config source was not prepared before promotion: ${located.absoluteSourcePath}`,
    );
  }
}

/** Exact prepared source captured under one already-trusted project claim. */
export function readPreparedViteConfigSource(
  fs: ReadFs,
  projectRoot: string,
): PreparedViteConfigSource | null {
  const root = normalizePath(projectRoot);
  const packageRoot = joinPath(root, 'node_modules/vite');
  if (fs.statSyncOrNull(packageRoot) === null) return null;
  const located = locateSource(fs, packageRoot);
  if (!viteConfigTempPatchApplied(located.source, located.policy.version)) {
    throw viteConfigTempNotImplemented(
      `Vite config source was not prepared before promotion: ${located.absoluteSourcePath}`,
    );
  }
  return {
    relativeSourcePath: `node_modules/vite/${located.policy.relativeSourcePath}`,
    sourceBytes: located.sourceBytes.slice(),
  };
}
