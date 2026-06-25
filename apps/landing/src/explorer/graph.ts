// Pure graph helpers over the structural EDGES (undirected). No DOM, no state.
// Used by the explorer to animate scenario flows along real package-graph paths.

import type { EdgeDef, NodeId } from './data';

export type Adjacency = Map<NodeId, Set<NodeId>>;

/**
 * Build an undirected adjacency map from the edge list.
 * Each edge contributes both directions. Deterministic insertion order.
 */
export function buildAdjacency(edges: readonly EdgeDef[]): Adjacency {
  const adj: Adjacency = new Map();
  const link = (a: NodeId, b: NodeId): void => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const e of edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  return adj;
}

/**
 * Shortest path (inclusive) between two nodes over the undirected edge graph.
 * Returns [] when no path exists, [from] when from === to, otherwise the full
 * node sequence from `from` to `to`. Deterministic: neighbours visited in their
 * insertion order, ties broken by first-discovered.
 */
export function bfsPath(adj: Adjacency, from: NodeId, to: NodeId): NodeId[] {
  if (from === to) return [from];
  const prev = new Map<NodeId, NodeId>();
  const seen = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  let head = 0;
  while (head < queue.length) {
    const n = queue[head];
    head += 1;
    if (n === undefined) break;
    if (n === to) break;
    const neighbours = adj.get(n);
    if (!neighbours) continue;
    for (const m of neighbours) {
      if (seen.has(m)) continue;
      seen.add(m);
      prev.set(m, n);
      queue.push(m);
    }
  }
  if (!seen.has(to)) return [];
  const path: NodeId[] = [];
  let cur: NodeId | undefined = to;
  while (cur !== undefined) {
    path.unshift(cur);
    if (cur === from) break;
    cur = prev.get(cur);
  }
  return path;
}
