import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';

const ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';
const TARBALL_URL = new URL('./esbuild-wasm-0.28.0.tgz', import.meta.url);
let tarballPromise: Promise<Uint8Array> | undefined;

function expectedIntegrity(): string {
  const descriptor = builtinShadowAssetCatalog.assets.find((asset) => asset.id === ASSET_ID);
  if (descriptor === undefined) throw new Error(`Builtin catalog omitted ${ASSET_ID}`);
  return descriptor.source.integrity;
}

export function assertPublishedEsbuildWasmTarballIntegrity(bytes: Uint8Array): void {
  const expected = expectedIntegrity();
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== expected) {
    throw new Error(
      `Vendored esbuild-wasm@0.28.0 tarball integrity mismatch: expected ${expected}, got ${actual}`,
    );
  }
}

async function loadPublishedEsbuildWasmTarball(): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(TARBALL_URL));
  assertPublishedEsbuildWasmTarballIntegrity(bytes);
  return bytes;
}

/** Exact upstream npm artifact; callers receive isolated bytes. */
export async function publishedEsbuildWasmTarball(): Promise<Uint8Array> {
  tarballPromise ??= loadPublishedEsbuildWasmTarball();
  return (await tarballPromise).slice();
}
