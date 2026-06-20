/**
 * Owner↔node-child fork-IPC (ADR-0155). The supervised `node <file>` server
 * child posts `rifty:node-listening{ports}` once its entry called `listen()`, so
 * the owner adds the ports to the preview registry. Mirrors `dev-server-ipc.ts`.
 */

/** Child→owner: server is listening on `ports` (resolves the controller boot). */
export interface NodeChildMessage {
  readonly type: 'rifty:node-listening';
  readonly ports: number[];
}

export function isNodeChildMessage(m: unknown): m is NodeChildMessage {
  if (!m || typeof m !== 'object') return false;
  const c = m as { type?: unknown; ports?: unknown };
  return (
    c.type === 'rifty:node-listening' &&
    Array.isArray(c.ports) &&
    c.ports.every((p) => typeof p === 'number')
  );
}
