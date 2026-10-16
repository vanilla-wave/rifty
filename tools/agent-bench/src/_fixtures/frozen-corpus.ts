import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * SHA256 of every `tools/agent-bench/corpus` file at the commits the correction tests
 * freeze against. Pinned in-tree so the checks survive without those commits in the
 * clone's history (ADR-0532: evidence lives in the tree, not in another branch).
 */
const digests = JSON.parse(
  readFileSync(new URL('frozen-corpus-digests.json', import.meta.url), 'utf8'),
) as Record<string, { label: string; files: Record<string, string> }>;

export function frozenDigest(commit: string, path: string): string {
  const matches = Object.keys(digests).filter((sha) => sha.startsWith(commit));
  if (matches.length !== 1) throw new Error(`Unknown frozen commit ${commit}`);
  const digest = digests[matches[0]!]!.files[path];
  if (digest === undefined) throw new Error(`No frozen digest for ${commit}:${path}`);
  return digest;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
