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
  readonly ownerToken: string | undefined;
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
  const port = Number.parseInt(required(env, 'RIFTY_DEV_PORT'), 10);
  const cfg = resolveBootstrapConfig(spec, port, root);
  const tokenRaw = env.RIFTY_PREVIEW_OWNER_TOKEN;
  return {
    spec,
    cfg,
    port,
    root,
    slug: required(env, 'RIFTY_RFV_SLUG'),
    fromScratch: env.RIFTY_RFV_SETUP === 'from-scratch',
    ownerToken: tokenRaw && tokenRaw !== '' ? tokenRaw : undefined,
  };
}
