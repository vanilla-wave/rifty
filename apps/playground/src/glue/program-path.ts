/**
 * Root-relative editor-program mirror path (ADR-0165 §4).
 *
 * The editor's permanent program tab mirrors the active template ENTRY under
 * `/scratch` or `/projects/<id>`, so program writes hit the same file the worker
 * bootstraps.
 *
 * Solid-free so App + EditorHost share ONE derivation (no drift) and it stays
 * unit-testable in the node vitest env.
 */
import { joinPath } from '@riftydev/vfs';
import type { ProjectSpec } from '../templates/project-spec.ts';

/** Active root + template spec → editor program-mirror path (ADR-0165 §4). */
export function programMirrorPath(root: string, spec: Pick<ProjectSpec, 'entry'>): string {
  return joinPath(root, spec.entry.relativePath);
}
