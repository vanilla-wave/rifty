/**
 * Owner-realm supervised dev-server child (ADR-0150 P6b): the dev server runs in
 * a serve:true child worker reading+writing the owner store over fs.* sync-RPC
 * (RIFTY_REMOTE_FS=1). The owner stays a free async supervisor — blocking work
 * (vite transform/install) left its thread. Mirrors owner-child-bin-executor.ts,
 * but the child is a long-lived SERVER (serve:true), not run-to-completion.
 */
import type { SpawnWorkerSpec } from '@riftydev/kernel';

export interface DevServerChildSpawnParams {
  readonly templateId: string;
  readonly slug: string;
  readonly setup: 'instant' | 'from-scratch';
  readonly root: string;
  /** The template's real dev port (distinct from the owner's 59124 bridge key). */
  readonly devPort: number;
  readonly ownerToken: string | undefined;
}

/** Pure: build the spawn spec for the dev-server child (unit-tested). */
export function buildDevServerChildSpawnSpec(
  params: DevServerChildSpawnParams,
  devServerWorkerUrl: string,
): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: devServerWorkerUrl },
    argv: ['rifty', 'dev-server'],
    env: {
      RIFTY_REMOTE_FS: '1',
      RIFTY_DEV_SERVER: '1',
      RIFTY_RFV_TEMPLATE: params.templateId,
      RIFTY_RFV_SLUG: params.slug,
      RIFTY_RFV_SETUP: params.setup,
      RIFTY_RFV_ROOT: params.root,
      RIFTY_DEV_PORT: String(params.devPort),
      RIFTY_PREVIEW_OWNER_TOKEN: params.ownerToken ?? '',
    },
    cwd: params.root,
    // ADR-0144: serve:true — the kernel does NOT reap the realm when the entry's
    // setup finishes; the dev server stays listening until the owner kills it.
    serve: true,
  };
}
