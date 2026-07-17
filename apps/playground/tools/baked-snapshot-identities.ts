import { createHash } from 'node:crypto';

export interface BakedSnapshotIdentityInput {
  readonly id: string;
  readonly serializedBytes: Uint8Array;
}

export interface BakedSnapshotOutput extends BakedSnapshotIdentityInput {
  readonly assetUrl: string;
  readonly compressedBytes: Uint8Array;
}

export interface BakedSnapshotIdentityManifest {
  readonly version: 1;
  readonly snapshots: Readonly<Record<string, string>>;
}

export interface BakedSnapshotOutputWriter {
  writeArtifact(assetUrl: string, bytes: Uint8Array): Promise<void>;
  writeIdentityManifest(contents: string): Promise<void>;
}

export function snapshotIdentityFromSerializedBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function buildBakedSnapshotIdentityManifest(
  inputs: readonly BakedSnapshotIdentityInput[],
): BakedSnapshotIdentityManifest {
  const snapshots: Record<string, string> = {};
  for (const input of [...inputs].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    if (Object.prototype.hasOwnProperty.call(snapshots, input.id)) {
      throw new TypeError(`Duplicate baked snapshot template id: ${input.id}`);
    }
    snapshots[input.id] = snapshotIdentityFromSerializedBytes(input.serializedBytes);
  }
  return Object.freeze({ version: 1 as const, snapshots: Object.freeze(snapshots) });
}

export function serializeBakedSnapshotIdentityManifest(
  manifest: BakedSnapshotIdentityManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function emitBakedSnapshotOutputs(
  outputs: readonly BakedSnapshotOutput[],
  writer: BakedSnapshotOutputWriter,
): Promise<void> {
  for (const output of outputs) {
    await writer.writeArtifact(output.assetUrl, output.compressedBytes);
  }
  const manifest = buildBakedSnapshotIdentityManifest(outputs);
  await writer.writeIdentityManifest(serializeBakedSnapshotIdentityManifest(manifest));
}
