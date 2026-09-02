/**
 * Template registry (ADR-0078). Maps a template id → its {@link ProjectSpec}.
 *
 * An unknown id throws {@link NotImplementedError} — there is deliberately NO
 * fallback to the default template and NO null return (the "no silent stubs"
 * hard rule): a misconfigured template id must fail loudly, not silently boot
 * the wrong runtime.
 */
import { NotImplementedError } from '@riftydev/vfs';
import { CLI_REPORT_TEMPLATE } from './cli-report.ts';
import { EXPRESS_SQLITE_TEMPLATE } from './express-sqlite.ts';
import { HIDDEN_EMPTY_TEMPLATE } from './hidden-empty.ts';
import { HONO_API_TEMPLATE } from './hono-api.ts';
import { KOA_API_TEMPLATE } from './koa-api.ts';
import { MARKDOWN_SSG_TEMPLATE } from './markdown-ssg.ts';
import type { ProjectSpec } from './project-spec.ts';
import { REACT_VITE_TEMPLATE } from './react-vite/index.ts';
import { SOCKET_LAB_TEMPLATE } from './socket-lab.ts';
import { TYPESCRIPT_TEMPLATE } from './typescript.ts';
import { VITE_TEMPLATE } from './vite.ts';
import { VITE8_TEMPLATE } from './vite8.ts';

export const DEFAULT_TEMPLATE_ID = 'vite';

const TEMPLATES: ReadonlyMap<string, ProjectSpec> = new Map<string, ProjectSpec>([
  [HIDDEN_EMPTY_TEMPLATE.id, HIDDEN_EMPTY_TEMPLATE],
  [VITE_TEMPLATE.id, VITE_TEMPLATE],
  [VITE8_TEMPLATE.id, VITE8_TEMPLATE],
  [REACT_VITE_TEMPLATE.id, REACT_VITE_TEMPLATE],
  [TYPESCRIPT_TEMPLATE.id, TYPESCRIPT_TEMPLATE],
  [EXPRESS_SQLITE_TEMPLATE.id, EXPRESS_SQLITE_TEMPLATE],
  [SOCKET_LAB_TEMPLATE.id, SOCKET_LAB_TEMPLATE],
  [HONO_API_TEMPLATE.id, HONO_API_TEMPLATE],
  [KOA_API_TEMPLATE.id, KOA_API_TEMPLATE],
  [CLI_REPORT_TEMPLATE.id, CLI_REPORT_TEMPLATE],
  [MARKDOWN_SSG_TEMPLATE.id, MARKDOWN_SSG_TEMPLATE],
]);

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

/** Every registered template — drives the snapshot bake script (ADR-0135). */
export function allProjectSpecs(): readonly ProjectSpec[] {
  return [...TEMPLATES.values()];
}
