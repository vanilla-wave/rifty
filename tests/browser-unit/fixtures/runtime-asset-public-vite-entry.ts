/// <reference lib="webworker" />

import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';
import {
  createHttpServer,
  dispatchToPort,
  serveCrossRealmPreview,
} from '../../../packages/net/src/index.ts';
import { registerNetBuiltins } from '../../../packages/net/src/register-builtins.ts';
import {
  SHADOW_ASSET_CAPABILITY,
  createShadowAssetPortClient,
  planBuiltinShadowAssets,
} from '../../../packages/npm-client/src/index.ts';
import { readNodeEntryBootstrap } from '../../../packages/runtime-js/src/builtins/node-entry-url.ts';
import { builtinShadowAssetCatalog } from '../../../tools/shadow-registry/src/index.ts';

const PROOF_PREFIX = 'RIFTY_RUNTIME_ASSET_PUBLIC_PROOF:';
const PREVIEW_PORT = 43_143;

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const capabilities = readKernelEntryCapabilityPorts();
const capability = capabilities[SHADOW_ASSET_CAPABILITY];
if (capability === undefined) {
  throw new Error(`missing URL-entry capability port '${SHADOW_ASSET_CAPABILITY}'`);
}

const plan = planBuiltinShadowAssets([
  {
    catalog: {
      id: builtinShadowAssetCatalog.id,
      digest: builtinShadowAssetCatalog.digest,
    },
    publicName: 'esbuild',
    requestedRange: '^0.27.0 || ^0.28.0',
    resolvedPublicVersion: '0.28.0',
    substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
    runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
    builtin: true,
  },
]);
const asset = plan.assets[0];
if (asset === undefined) throw new Error('runtime-asset public fixture expected one planned asset');

const client = createShadowAssetPortClient({ port: capability, plan });
const assetBytes = await client.readVerified(asset.id, { deadlineMs: 30_000 });
const ownedAssetBytes = new ArrayBuffer(assetBytes.byteLength);
new Uint8Array(ownedAssetBytes).set(assetBytes);
const assetSha256 = hex(await crypto.subtle.digest('SHA-256', ownedAssetBytes));
if (assetSha256 !== asset.memberSha256 || assetBytes.byteLength !== asset.memberSize) {
  throw new Error('runtime-asset public fixture received bytes outside the attested descriptor');
}

const proof = Object.freeze({
  capabilityKeys: Object.keys(capabilities),
  requiredSetDigest: plan.requiredSetDigest,
  assetId: asset.id,
  assetSha256,
  assetSize: assetBytes.byteLength,
});
const proofText = JSON.stringify(proof);
const childProcess = (
  globalThis as unknown as {
    readonly process?: {
      readonly stdout?: { write(chunk: string): unknown };
      readonly send?: (message: unknown) => unknown;
    };
  }
).process;
if (typeof childProcess?.stdout?.write !== 'function' || typeof childProcess.send !== 'function') {
  throw new Error('runtime-asset public fixture requires child stdio and fork IPC');
}
childProcess.stdout.write(`${PROOF_PREFIX}${proofText}\n`);

registerNetBuiltins();
const server = createHttpServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(proofText);
});
await new Promise<void>((resolve, reject) => {
  const onError = (error: unknown): void => reject(error);
  server.once('error', onError);
  server.listen(PREVIEW_PORT, () => {
    server.removeListener('error', onError);
    resolve();
  });
});

const launch = readNodeEntryBootstrap().launch;
const previewScope = launch.kind === 'program' ? launch.previewScope : undefined;
serveCrossRealmPreview(
  PREVIEW_PORT,
  async (request) => dispatchToPort(PREVIEW_PORT, request),
  previewScope === undefined ? {} : { scope: previewScope },
);
childProcess.send({
  type: 'rifty:node-listening',
  ports: [PREVIEW_PORT],
  ...(previewScope === undefined ? {} : { previewScope }),
});
