/**
 * Root-relative editor-program mirror path (ADR-0165 §4).
 *
 * The editor's permanent program tab mirrors the dev-server ENTRY, which runs at
 * `<activeRoot>/src/main.js` — every template's `entry.relativePath` is
 * `/src/main.js` (vite + node-server alike). Pre-ADR-0165 the root was a hardcoded
 * `/workspace`, so the mirror was a const; the multi-project move made the root
 * dynamic (`/scratch` or `/projects/<id>`), so the program write + HMR must follow
 * it — otherwise they land on a dead path the dev server never reads (a node-server
 * starter then runs the stale browser entry → `document is not defined`).
 *
 * Solid-free so App + EditorHost share ONE derivation (no drift) and it stays
 * unit-testable in the node vitest env.
 */
import { joinPath } from '@riftydev/vfs';

/** Active-root → editor program-mirror path: `<root>/src/main.js` (ADR-0165 §4). */
export function programMirrorPath(root: string): string {
  return joinPath(root, 'src/main.js');
}
