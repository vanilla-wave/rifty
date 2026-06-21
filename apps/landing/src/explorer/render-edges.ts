// SVG edge layer. Straight lines between node-border intersection points
// (where the centre-to-centre line crosses each node's rect). Recomputed live
// as nodes move. Per-edge visual state derives from the active path.

import { EDGES, type EdgeDef, type NodeId, type Pos } from './data';

const NS = 'http://www.w3.org/2000/svg';

// node half-extents (px) for the border-intersection clip.
export interface NodeSize {
  hw: number;
  hh: number;
}

// per-render path state computed in explorer.ts.
export interface EdgePathState {
  overview: boolean;
  doneEdges: Set<string>;
  segEdges: Set<string>;
  allEdges: Set<string>;
  hover: NodeId | null;
}

export interface EdgeLayer {
  svg: SVGSVGElement;
  redraw: (pos: Record<NodeId, Pos>, sizes: Record<NodeId, NodeSize>, state: EdgePathState) => void;
}

export function edgeKey(a: NodeId, b: NodeId): string {
  return `${a}|${b}`;
}

function marker(id: string, color: string): string {
  return (
    `<marker id="${id}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">` +
    `<path d="M0 0 L6 3 L0 6 Z" fill="${color}"/></marker>`
  );
}

// border-intersection point: from centre C toward T, clipped to C's rect.
function borderPoint(c: Pos, t: Pos, s: NodeSize): { x: number; y: number } {
  const dx = t[0] - c[0];
  const dy = t[1] - c[1];
  if (dx === 0 && dy === 0) return { x: c[0], y: c[1] };
  const k = 1 / Math.max(Math.abs(dx) / (s.hw + 7), Math.abs(dy) / (s.hh + 7));
  return { x: c[0] + dx * k, y: c[1] + dy * k };
}

const FALLBACK: NodeSize = { hw: 40, hh: 18 };

// Build the SVG edge layer once; `redraw` re-renders all edge paths.
export function createEdgeLayer(impl: 1 | 3, width: number, height: number): EdgeLayer {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('data-sch-svg', '');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = marker(`sF${impl}`, 'rgba(255,255,255,0.45)') + marker(`sA${impl}`, 'var(--ac)');
  svg.appendChild(defs);

  const redraw: EdgeLayer['redraw'] = (pos, sizes, state) => {
    for (const p of Array.from(svg.querySelectorAll('[data-edge]'))) p.remove();
    const hov = state.hover;
    for (const ed of EDGES) {
      const a = pos[ed.from];
      const b = pos[ed.to];
      if (!a || !b) continue;
      const sa = sizes[ed.from] ?? FALLBACK;
      const sb = sizes[ed.to] ?? FALLBACK;
      const p1 = borderPoint(a, b, sa);
      const p2 = borderPoint(b, a, sb);
      const k1 = edgeKey(ed.from, ed.to);
      const k2 = edgeKey(ed.to, ed.from);
      const done = state.doneEdges.has(k1) || state.doneEdges.has(k2);
      const seg = state.segEdges.has(k1) || state.segEdges.has(k2);
      const all = state.allEdges.has(k1) || state.allEdges.has(k2);
      const onHover = hov !== null && (ed.from === hov || ed.to === hov);

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('data-edge', '');
      path.setAttribute('data-edge-kind', ed.kind);
      path.setAttribute('d', `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`);
      path.setAttribute('fill', 'none');

      let stroke = 'rgba(255,255,255,0.16)';
      let strokeWidth = '1.4';
      let mk = `sF${impl}`;
      let opacity = '1';
      const baseDash = dashFor(ed);
      if (baseDash) path.setAttribute('stroke-dasharray', baseDash);

      if (hov !== null) {
        if (onHover) {
          stroke = 'rgb(from var(--ac) r g b / 0.85)';
          strokeWidth = '2';
          mk = `sA${impl}`;
        } else {
          opacity = '0.14';
        }
      } else if (seg) {
        stroke = 'var(--ac)';
        strokeWidth = '2.8';
        mk = `sA${impl}`;
        path.setAttribute('stroke-dasharray', '7 5');
        path.classList.add('exp-edge-flow');
      } else if (done) {
        stroke = 'rgb(from var(--ac) r g b / 0.55)';
        strokeWidth = '1.9';
        mk = `sA${impl}`;
      } else if (all) {
        stroke = 'rgb(from var(--ac) r g b / 0.32)';
        strokeWidth = '1.7';
        mk = `sA${impl}`;
      } else {
        opacity = state.overview ? '1' : '0.14';
      }
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeWidth);
      path.setAttribute('opacity', opacity);
      if (ed.kind !== 'import' || all || seg || done) {
        path.setAttribute('marker-end', `url(#${mk})`);
      }
      svg.appendChild(path);
    }
  };

  return { svg, redraw };
}

function dashFor(ed: EdgeDef): string | null {
  if (ed.kind === 'control') return '5 4';
  if (ed.kind === 'ipc') return '4 4';
  return null;
}
