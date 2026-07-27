import { describe, expect, it } from 'vitest';
import { EDGES, NODES, REALMS, SCN } from './data';
import type { EdgeDef, NodeId, ScenarioId } from './data';
import { type Adjacency, bfsPath, buildAdjacency } from './graph';

const adj = buildAdjacency(EDGES);

function hasEdge(edges: readonly EdgeDef[], a: NodeId, b: NodeId): boolean {
  return edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

function isEdgeAdjacentPath(edges: readonly EdgeDef[], path: readonly NodeId[]): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === undefined || b === undefined) return false;
    if (!hasEdge(edges, a, b)) return false;
  }
  return true;
}

describe('buildAdjacency', () => {
  it('is symmetric — every neighbour relation goes both ways', () => {
    const built: Adjacency = buildAdjacency(EDGES);
    for (const [node, neighbours] of built) {
      for (const m of neighbours) {
        expect(built.get(m)?.has(node)).toBe(true);
      }
    }
  });

  it('places every topology node in exactly one runtime realm', () => {
    const realmNodes = REALMS.flatMap((realm) => realm.nodes);
    expect(realmNodes.toSorted()).toEqual(Object.keys(NODES).toSorted());
    expect(new Set(realmNodes).size).toBe(realmNodes.length);
    expect(REALMS.find((realm) => realm.id === 'ext')?.nodes).toEqual(['registry']);
  });

  it('contains exactly the nodes referenced by edges', () => {
    const built = buildAdjacency(EDGES);
    for (const e of EDGES) {
      expect(built.has(e.from)).toBe(true);
      expect(built.has(e.to)).toBe(true);
      expect(built.get(e.from)?.has(e.to)).toBe(true);
      expect(built.get(e.to)?.has(e.from)).toBe(true);
    }
  });
});

describe('bfsPath', () => {
  it('returns [node] for the same-node case', () => {
    expect(bfsPath(adj, 'kernel', 'kernel')).toEqual(['kernel']);
  });

  it('returns [] when no path exists (disconnected node)', () => {
    // An isolated node has no adjacency entry; nothing reaches it.
    const lonely = buildAdjacency([{ from: 'kernel', to: 'sab', kind: 'data' }]);
    expect(bfsPath(lonely, 'kernel', 'vfs')).toEqual([]);
  });

  it('every BFS path is edge-adjacent with correct endpoints', () => {
    // direct edge → length-2 path
    const p = bfsPath(adj, 'playground', 'workbench');
    expect(p[0]).toBe('playground');
    expect(p[p.length - 1]).toBe('workbench');
    expect(p).toHaveLength(2);
    expect(isEdgeAdjacentPath(EDGES, p)).toBe(true);
  });

  it('routes every consecutive step pair across ALL scenarios over real edges', () => {
    const ids = Object.keys(SCN) as ScenarioId[];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const steps = SCN[id].steps;
      expect(steps.length).toBeGreaterThan(0);
      for (let i = 0; i < steps.length - 1; i++) {
        const from = steps[i]?.node;
        const to = steps[i + 1]?.node;
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        if (from === undefined || to === undefined) continue;
        const path = bfsPath(adj, from, to);
        // connected: a real path exists between every consecutive milestone
        expect(path.length).toBeGreaterThan(0);
        // correct endpoints
        expect(path[0]).toBe(from);
        expect(path[path.length - 1]).toBe(to);
        // every hop is a real edge
        expect(isEdgeAdjacentPath(EDGES, path)).toBe(true);
      }
    }
  });

  it('is deterministic — repeated calls yield identical paths', () => {
    const a = bfsPath(adj, 'preview', 'vfs');
    const b = bfsPath(adj, 'preview', 'vfs');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(isEdgeAdjacentPath(EDGES, a)).toBe(true);
  });
});

describe('scenario contracts', () => {
  it('routes preview fetches through the page-side Workbench bridge', () => {
    expect(EDGES).toContainEqual({ from: 'sw', to: 'workbench', kind: 'ipc' });
    expect(EDGES).not.toContainEqual({ from: 'sw', to: 'owner', kind: 'ipc' });
    expect(bfsPath(adj, 'workbench', 'net')).toEqual(['workbench', 'net']);
    expect(bfsPath(adj, 'runtimejs', 'net')).toEqual(['runtimejs', 'net']);
    expect(SCN.express.steps.map((step) => step.node)).toContain('workbench');
  });

  it('keeps HMR on the direct net-to-preview bridge', () => {
    expect(bfsPath(adj, 'net', 'preview')).toEqual(['net', 'preview']);
    expect(NODES.sw.role).not.toContain('HMR');
  });

  it('keeps standalone PAGE VFS boot separate from the owner VFS', () => {
    expect(NODES.sandboxvfs.realm).toBe('page');
    expect(SCN.boot.steps.map((step) => step.node)).toEqual([
      'sdk',
      'sandboxvfs',
      'sw',
      'runtimejs',
    ]);
  });

  it('keeps SAB-specific sync I/O scoped to a supervised Workbench child', () => {
    expect(SCN.sync.label).toBe('Workbench child sync fs');
    expect(SCN.sync.steps.map((step) => step.node)).toEqual([
      'runtimejs',
      'sab',
      'owner',
      'vfs',
      'runtimejs',
    ]);
  });

  it('does not claim SAB transport or a universal JS VFS for WASI', () => {
    const copy = SCN.wasi.steps.map((step) => step.t).join(' ');
    expect(copy).not.toMatch(/\bSAB\b|same VFS as JS/);
    expect(SCN.wasi.steps.some((step) => step.node === 'sab')).toBe(false);
  });
});
