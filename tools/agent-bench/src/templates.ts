/**
 * Template source for lane workspaces.
 *
 * agent-bench hook rationale: this file READS playground template modules
 * (plain TS data, no DOM/solid) so the local-reference lane materializes the
 * SAME preset source the playground seeds (ADR-0191 lane-equivalence). This is
 * judge/setup-facing tooling code, not a product import — the arrow points
 * tool → app, never the reverse.
 */
import { HONO_API_TEMPLATE } from '../../../apps/playground/src/templates/hono-api.ts';
import {
  type ProjectSpec,
  resolveBootstrapConfig,
} from '../../../apps/playground/src/templates/project-spec.ts';
import { REACT_VITE_TEMPLATE } from '../../../apps/playground/src/templates/react-vite.ts';
import type { FileTree } from './seed.ts';

export type TemplateId = 'react-vite' | 'hono-api';

const TEMPLATES: Record<TemplateId, ProjectSpec> = {
  'react-vite': REACT_VITE_TEMPLATE,
  'hono-api': HONO_API_TEMPLATE,
};

export function templateSpec(id: TemplateId): ProjectSpec {
  const spec = TEMPLATES[id];
  if (!spec) throw new Error(`agent-bench: unknown template id '${id}'`);
  return spec;
}

/**
 * Project file tree for a template, exactly as the playground worker would seed
 * it (same `resolveBootstrapConfig` mapping), as relative paths. The fake
 * `.git/HEAD` + `.git/config` seeds are dropped: the local lane runs a REAL
 * `git init` so `git diff` works; `.gitignore` is kept (part of the project).
 */
export function templateWorkspaceFiles(id: TemplateId): FileTree {
  const spec = templateSpec(id);
  const cfg = resolveBootstrapConfig(spec, spec.defaultPort, '');
  const tree: FileTree = {};
  for (const [absPath, content] of Object.entries(cfg.seedFiles)) {
    if (absPath === '/.git/HEAD' || absPath === '/.git/config') continue;
    tree[absPath.replace(/^\//, '')] = content;
  }
  return tree;
}
