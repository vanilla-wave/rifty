import type { ShadowRuntimeTier } from '@riftydev/shadow-registry/internal';
import generated from '../generated/install-artifact-identity.json';

const identity = (generated as { readonly identity?: unknown }).identity;
if (typeof identity !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(identity)) {
  throw new Error('Malformed generated install-artifact identity');
}

/** Build-generated identity of every policy byte that can change an installed tree. */
export const installArtifactIdentity = identity;
const coiIdentity = (generated as { readonly coiIdentity?: unknown }).coiIdentity;
if (typeof coiIdentity !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(coiIdentity)) {
  throw new Error('Malformed generated COI install-artifact identity');
}

/** The same catalog can materialize different executable trees in the two hosts. */
export function installArtifactIdentityForTier(runtimeTier: ShadowRuntimeTier = 'no-coi'): string {
  if (runtimeTier === 'no-coi') return installArtifactIdentity;
  if (runtimeTier === 'coi') return coiIdentity;
  throw new TypeError('Unknown install runtime tier');
}
