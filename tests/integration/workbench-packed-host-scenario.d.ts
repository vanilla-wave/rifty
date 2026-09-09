export function produceFromInstalledWorkbenchTarball(): Promise<{
  readonly snapshotId: string;
  readonly tarBytes: Uint8Array;
  readonly entry: '@riftydev/workbench/dep-snapshot';
}>;

export function provePackedHostOrphanRetain(): Promise<{
  readonly downloaded: string;
  readonly host: {
    readonly scope: '/sandbox/';
    readonly previewPrefix: '/sandbox/preview';
    readonly snapshotOnly: true;
  };
}>;
