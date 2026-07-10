/**
 * Pure dev-server child boot-config resolver (ADR-0150 P6b). LIGHT imports
 * (templates only) so the unit test resolves WITHOUT pulling the heavy boot
 * module (vite / sql.js). The entry (dev-server-child-bootstrap.ts) imports this.
 */
import {
  type BootstrapConfig,
  type ProjectSpec,
  resolveBootstrapConfig,
} from '../templates/project-spec.ts';
import { resolveProjectSpec } from '../templates/registry.ts';

export interface DevServerChildConfig {
  readonly spec: ProjectSpec;
  readonly cfg: BootstrapConfig;
  readonly port: number;
  readonly root: string;
  readonly slug: string;
  readonly fromScratch: boolean;
  readonly previewScope?: string;
}

/** Nodemon's app is a nested Worker and owns its own net registry/preview bridge. */
export function devServerOwnsPortsLocally(spec: ProjectSpec): boolean {
  return !(spec.runtime === 'node-server' && spec.devRunner === 'nodemon');
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (typeof v !== 'string' || v === '') {
    throw new Error(`dev-server-child: missing required env ${key}`);
  }
  return v;
}

/** Pure: rebuild the dev-server boot config from the spawn env (unit-tested). */
export function resolveDevServerChildConfig(
  env: Record<string, string | undefined>,
): DevServerChildConfig {
  const spec = resolveProjectSpec(required(env, 'RIFTY_RFV_TEMPLATE'));
  const root = required(env, 'RIFTY_RFV_ROOT');
  const portRaw = required(env, 'RIFTY_DEV_PORT');
  const port = Number.parseInt(portRaw, 10);
  // Loud failure over a silent NaN port (which would bind nowhere / 502 the
  // preview): a non-numeric RIFTY_DEV_PORT is a spawn-spec bug, not a runtime input.
  if (!Number.isInteger(port)) {
    throw new Error(`dev-server-child: RIFTY_DEV_PORT is not an integer: ${portRaw}`);
  }
  const cfg = resolveBootstrapConfig(spec, port, root);
  return {
    spec,
    cfg,
    port,
    root,
    slug: required(env, 'RIFTY_RFV_SLUG'),
    fromScratch: env.RIFTY_RFV_SETUP === 'from-scratch',
    ...(env.RIFTY_PREVIEW_SCOPE ? { previewScope: env.RIFTY_PREVIEW_SCOPE } : {}),
  };
}
