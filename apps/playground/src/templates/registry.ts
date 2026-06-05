/**
 * Template registry (ADR-0078). Maps a template id → its {@link ProjectSpec}.
 *
 * An unknown id throws {@link NotImplementedError} — there is deliberately NO
 * fallback to the default template and NO null return (the "no silent stubs"
 * hard rule): a misconfigured template id must fail loudly, not silently boot
 * the wrong runtime.
 */
import { NotImplementedError } from '@riftydev/vfs';
import type { ProjectSpec } from './project-spec.ts';
import { VITE_TEMPLATE } from './vite.ts';

export const DEFAULT_TEMPLATE_ID = 'vite';

const TEMPLATES: ReadonlyMap<string, ProjectSpec> = new Map([[VITE_TEMPLATE.id, VITE_TEMPLATE]]);

/** Resolve a template id to its spec, or throw for an unregistered id. */
export function resolveProjectSpec(id: string): ProjectSpec {
  const spec = TEMPLATES.get(id);
  if (!spec) {
    throw new NotImplementedError('templates.resolveProjectSpec', `unknown template id: ${id}`);
  }
  return spec;
}

/** The default template (Vite) — used when no explicit template is selected. */
export function defaultProjectSpec(): ProjectSpec {
  return resolveProjectSpec(DEFAULT_TEMPLATE_ID);
}
