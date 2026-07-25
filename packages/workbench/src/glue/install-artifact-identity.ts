import generated from '../generated/install-artifact-identity.json';

const identity = (generated as { readonly identity?: unknown }).identity;
if (typeof identity !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(identity)) {
  throw new Error('Malformed generated install-artifact identity');
}

/** Build-generated identity of every policy byte that can change an installed tree. */
export const installArtifactIdentity = identity;
