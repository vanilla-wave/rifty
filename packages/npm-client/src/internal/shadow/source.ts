import { type ShadowRuntimeAsset, shadowSha256 } from '@riftydev/shadow-registry/internal';
import type { RegistryClient } from '../../registry.ts';
import { computeIntegrity, parseIntegrityAlgorithm } from '../../tarball-cache.ts';
import { parseTarEntries } from '../../unpacker.ts';
import type { ShadowAssetSource } from './manager.ts';

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('shadow asset acquisition aborted');
}

async function gunzipBounded(
  bytes: Uint8Array,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (signal.aborted) throw abortReason(signal);
  if (typeof DecompressionStream !== 'function')
    throw new Error('shadow assets require gzip support');
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let onAbort: (() => void) | undefined;
      const read = reader.read();
      read.catch(() => {});
      const abortWait = new Promise<never>((_, reject) => {
        onAbort = () => reject(abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const next = await Promise.race([read, abortWait]).finally(() => {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      });
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        throw new Error(`shadow asset archive exceeds ${maxBytes} unpacked bytes`);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function createRegistryShadowAssetSource(registry: RegistryClient): ShadowAssetSource {
  return Object.freeze({
    async acquire(asset: Readonly<ShadowRuntimeAsset>, signal: AbortSignal): Promise<Uint8Array> {
      if (signal.aborted) throw signal.reason;
      const packument = await registry.getPackument(asset.source.name, { signal });
      if (signal.aborted) throw signal.reason;
      const manifest = packument.versions[asset.source.version];
      if (
        !manifest ||
        manifest.name !== asset.source.name ||
        manifest.version !== asset.source.version ||
        manifest.dist.integrity !== asset.source.integrity
      ) {
        throw new Error(`shadow asset source provenance drifted for ${asset.id}`);
      }
      const tarball = await registry.getTarball(manifest.dist.tarball, {
        signal,
        maxBytes: asset.maxTarballBytes,
      });
      if (signal.aborted) throw signal.reason;
      const algorithm = parseIntegrityAlgorithm(asset.source.integrity);
      if (
        algorithm === null ||
        (await computeIntegrity(tarball, algorithm)) !== asset.source.integrity
      ) {
        throw new Error(`shadow asset source integrity mismatch for ${asset.id}`);
      }
      const tar = await gunzipBounded(tarball, asset.maxUnpackedBytes, signal);
      if (signal.aborted) throw abortReason(signal);
      const matches = parseTarEntries(tar).filter((entry) => entry.name === asset.member);
      if (signal.aborted) throw abortReason(signal);
      if (matches.length !== 1)
        throw new Error(`shadow asset member ${asset.member} must occur exactly once`);
      const member = matches[0]!.data.slice();
      if (member.byteLength !== asset.memberSize || shadowSha256(member) !== asset.memberSha256) {
        throw new Error(`shadow asset member identity mismatch for ${asset.id}`);
      }
      return member;
    },
  });
}
