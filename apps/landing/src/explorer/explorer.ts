// Interactive architecture explorer — embedded mode. Builds the full widget:
// inline view switcher, scenario player bar, legend, draggable/pannable/zoomable
// canvas with three views (Schema / Realms / Hybrid), BFS scenario playback,
// hover/pin inspector. Pure vanilla TS over the data in ./data.

import './explorer.css';
import {
  DEFPOS,
  EDGES,
  HPOS,
  KINDS,
  KIND_OF,
  NODES,
  type NodeId,
  type Pos,
  REALMS,
  REALM_COL,
  type Realm,
  SCN,
  SCN_NONE,
  type ScenarioId,
  ZONES,
  type ZoneDef,
} from './data';
import { bfsPath, buildAdjacency } from './graph';
import { renderInspector } from './inspector';
import {
  type EdgeLayer,
  type EdgePathState,
  type NodeSize,
  createEdgeLayer,
  edgeKey,
} from './render-edges';
import { RICH_NODES, createNodeEl, updateSurfaces } from './render-nodes';

type ImplId = 1 | 2 | 3;
type ScnState = ScenarioId | 'none';

const ADJ = buildAdjacency(EDGES);
const NODE_IDS = Object.keys(NODES) as NodeId[];

const STEP_MS = 1150;
const WORLD_W = 1120;
const SCHEMA_H = 660;
const HYBRID_H = 690;
const DRAG_THRESHOLD = 1;

interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

// Realms (view 2) is non-graphical: it keeps its own scroll position instead of
// a pan/zoom transform, so switching away and back preserves where you were.
interface RealmsScroll {
  scrollLeft: number;
  scrollTop: number;
}

interface SegmentPath {
  nodes: NodeId[];
  edges: { from: NodeId; to: NodeId }[];
}

interface PathState {
  overview: boolean;
  curNode: NodeId | null;
  touched: Set<NodeId>;
  segNodes: Set<NodeId>;
  allNodes: Set<NodeId>;
  doneEdges: Set<string>;
  segEdges: Set<string>;
  allEdges: Set<string>;
}

interface BoardCfg {
  defKey: Record<NodeId, Pos>;
  zones: boolean;
  worldH: number;
}

const BOARDS: Record<1 | 3, BoardCfg> = {
  1: { defKey: DEFPOS, zones: false, worldH: SCHEMA_H },
  3: { defKey: HPOS, zones: true, worldH: HYBRID_H },
};

const REALM_LABELS: { id: Realm; name: string }[] = [
  { id: 'page', name: 'page' },
  { id: 'worker', name: 'worker' },
  { id: 'sw', name: 'service worker' },
  { id: 'iframe', name: 'iframe' },
  { id: 'ext', name: 'external' },
];

const SCN_CHIPS: { id: ScnState; label: string }[] = [
  { id: 'boot', label: 'Boot' },
  { id: 'npm', label: 'npm install' },
  { id: 'express', label: 'Express + preview' },
  { id: 'vite', label: 'Vite HMR' },
  { id: 'wasi', label: 'Raw WASI' },
  { id: 'sync', label: 'Sync fs (SAB)' },
];

const OVERVIEW_CAPTION =
  'The full runtime graph. Hover a module to see its links, drag to rearrange — ' +
  'or pick a scenario to follow its narrated steps and the structural modules connecting them.';

function clonePos(src: Record<NodeId, Pos>): Record<NodeId, Pos> {
  const out = {} as Record<NodeId, Pos>;
  for (const id of NODE_IDS) {
    const p = src[id];
    out[id] = [p[0], p[1]];
  }
  return out;
}

function defaultView(): ViewTransform {
  return { tx: 20, ty: 12, scale: 1 };
}

function kindSvg(paths: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// One draggable/zoomable board (Schema impl=1 or Hybrid impl=3).
interface Board {
  impl: 1 | 3;
  root: HTMLElement;
  viewport: HTMLElement;
  world: HTMLElement;
  inspectorEl: HTMLElement;
  edgeLayer: EdgeLayer;
  nodeEls: Map<NodeId, HTMLDivElement>;
  zoneEls: Map<Realm, HTMLElement>;
  pos: Record<NodeId, Pos>;
}

// Builds the explorer into `root` and returns a cleanup function that tears down
// window listeners and any in-flight scenario timer. Call it before discarding
// the root (SPA route change / re-mount) to avoid leaked listeners + timers.
export function mountExplorer(root: HTMLElement): () => void {
  // ---- state ----
  let impl: ImplId = window.matchMedia('(max-width: 600px)').matches ? 2 : 1;
  let scn: ScnState = 'none';
  let step = 0;
  let playing = false;
  let hover: NodeId | null = null;
  // null = nothing pinned → inspector hidden at rest so it never covers the graph.
  let inspect: NodeId | null = null;

  const view: Record<1 | 3, ViewTransform> = {
    1: defaultView(),
    3: defaultView(),
  };
  // Realms view scroll memory (view 2 has no transform — see RealmsScroll).
  const realmsScroll: RealmsScroll = { scrollLeft: 0, scrollTop: 0 };

  let playTimer: ReturnType<typeof setTimeout> | null = null;
  const scnPathCache = new Map<ScenarioId, SegmentPath[]>();

  // drag/pan transient state
  let drag: {
    board: Board;
    id: NodeId;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null = null;
  let pan: { board: Board; x: number; y: number } | null = null;
  let suppressNodeClick: NodeId | null = null;
  let suppressNodeClickTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- derive ----
  const isOverview = (): boolean => scn === 'none';
  const curScn = () => (isOverview() ? SCN_NONE : SCN[scn as ScenarioId]);
  const trace = () => curScn().steps;

  function scnSegments(id: ScenarioId): SegmentPath[] {
    const cached = scnPathCache.get(id);
    if (cached) return cached;
    const steps = SCN[id].steps;
    const segs: SegmentPath[] = [];
    const first = steps[0];
    segs.push({ nodes: first ? [first.node] : [], edges: [] });
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const cur = steps[i];
      if (!prev || !cur) continue;
      const path = bfsPath(ADJ, prev.node, cur.node);
      const nodes: NodeId[] = [];
      const edges: { from: NodeId; to: NodeId }[] = [];
      for (let j = 1; j < path.length; j++) {
        const a = path[j - 1];
        const b = path[j];
        if (a === undefined || b === undefined) continue;
        nodes.push(b);
        edges.push({ from: a, to: b });
      }
      segs.push({ nodes, edges });
    }
    scnPathCache.set(id, segs);
    return segs;
  }

  function pathState(): PathState {
    if (isOverview()) {
      return {
        overview: true,
        curNode: null,
        touched: new Set(),
        segNodes: new Set(),
        allNodes: new Set(),
        doneEdges: new Set(),
        segEdges: new Set(),
        allEdges: new Set(),
      };
    }
    const id = scn as ScenarioId;
    const segs = scnSegments(id);
    const cur = step;
    const touched = new Set<NodeId>();
    const doneEdges = new Set<string>();
    for (let i = 0; i <= cur && i < segs.length; i++) {
      const s = segs[i];
      if (!s) continue;
      for (const n of s.nodes) touched.add(n);
      for (const e of s.edges) doneEdges.add(edgeKey(e.from, e.to));
    }
    const seg = segs[cur] ?? { nodes: [], edges: [] };
    const segNodes = new Set<NodeId>(seg.nodes);
    const segEdges = new Set<string>(seg.edges.map((e) => edgeKey(e.from, e.to)));
    const allNodes = new Set<NodeId>();
    const allEdges = new Set<string>();
    for (const s of segs) {
      for (const n of s.nodes) allNodes.add(n);
      for (const e of s.edges) allEdges.add(edgeKey(e.from, e.to));
    }
    const stepDef = SCN[id].steps[cur];
    return {
      overview: false,
      curNode: stepDef ? stepDef.node : null,
      touched,
      segNodes,
      allNodes,
      doneEdges,
      segEdges,
      allEdges,
    };
  }

  // ---- DOM scaffolding ----
  root.classList.add('exp');
  root.innerHTML = '';

  // view switcher (inline / embedded)
  const switcher = document.createElement('div');
  switcher.className = 'exp-switcher';
  switcher.innerHTML = '<span class="exp-switcher-label">view</span>';
  const switcherBtns = new Map<ImplId, HTMLButtonElement>();
  const switcherDefs: [ImplId, string][] = [
    [1, 'Schema'],
    [2, 'Realms'],
    [3, 'Hybrid'],
  ];
  for (const [n, label] of switcherDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'exp-view-btn';
    btn.innerHTML = `<span class="exp-view-num">0${n}</span>${label}`;
    btn.addEventListener('click', () => setImpl(n));
    switcher.appendChild(btn);
    switcherBtns.set(n, btn);
  }
  root.appendChild(switcher);

  // scenario player bar
  const bar = document.createElement('div');
  bar.className = 'exp-bar';
  const rowA = document.createElement('div');
  rowA.className = 'exp-bar-row exp-bar-chips';
  rowA.innerHTML = '<span class="exp-bar-label">scenario</span>';
  const chipEls = new Map<ScnState, HTMLButtonElement>();

  const wholeChip = document.createElement('button');
  wholeChip.type = 'button';
  wholeChip.className = 'exp-chip exp-chip-whole';
  wholeChip.innerHTML = `${kindSvg(
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    13,
  )}Whole schema`;
  wholeChip.addEventListener('click', () => setScn('none'));
  rowA.appendChild(wholeChip);
  chipEls.set('none', wholeChip);

  const divider = document.createElement('span');
  divider.className = 'exp-bar-divider';
  rowA.appendChild(divider);

  for (const { id, label } of SCN_CHIPS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'exp-chip';
    chip.innerHTML = `<span class="exp-chip-dot"></span>${label}`;
    chip.addEventListener('click', () => onChipClick(id));
    rowA.appendChild(chip);
    chipEls.set(id, chip);
  }
  bar.appendChild(rowA);

  const rowB = document.createElement('div');
  rowB.className = 'exp-bar-row exp-bar-status';
  rowB.innerHTML =
    '<div class="exp-bar-status-main">' +
    '<div class="exp-bar-status-top">' +
    '<span class="exp-scn-title" data-scn-title></span>' +
    '<span class="exp-step-num" data-step-num></span></div>' +
    '<div class="exp-step-caption" data-step-caption>&nbsp;</div></div>';
  bar.appendChild(rowB);

  const track = document.createElement('div');
  track.className = 'exp-progress-track';
  const fill = document.createElement('div');
  fill.className = 'exp-progress-fill';
  track.appendChild(fill);
  bar.appendChild(track);
  root.appendChild(bar);

  const titleEl = rowB.querySelector<HTMLElement>('[data-scn-title]');
  const stepNumEl = rowB.querySelector<HTMLElement>('[data-step-num]');
  const captionEl = rowB.querySelector<HTMLElement>('[data-step-caption]');

  // legend + controls
  const legendRow = document.createElement('div');
  legendRow.className = 'exp-legend';
  legendRow.innerHTML = buildLegendHtml();
  const controls = document.createElement('div');
  controls.className = 'exp-controls';
  controls.innerHTML = '<span class="exp-hint">drag nodes · drag canvas to pan</span>';
  const resetBtn = mkCtrlBtn('exp-reset-btn', 'Reset');
  controls.appendChild(resetBtn);
  legendRow.appendChild(controls);
  root.appendChild(legendRow);

  // boards: one container per view; only the active one is shown.
  const boards: Record<1 | 3, Board> = {
    1: buildBoard(1),
    3: buildBoard(3),
  };
  const realms = buildRealmsView();

  root.appendChild(boards[1].root);
  root.appendChild(realms.root);
  root.appendChild(boards[3].root);

  // ---- board construction ----
  function buildBoard(boardImpl: 1 | 3): Board {
    const cfg = BOARDS[boardImpl];
    const container = document.createElement('div');
    container.className = 'exp-board';
    const viewport = document.createElement('div');
    viewport.className = 'exp-viewport';
    if (cfg.zones) viewport.classList.add('exp-viewport-plain');
    // Zoom is gone (it hijacked page scroll), so the viewport must be tall enough
    // to show the whole world at scale 1 — otherwise the bottom row clips.
    viewport.style.height = `${cfg.worldH}px`;
    const world = document.createElement('div');
    world.className = 'exp-world';
    world.style.width = `${WORLD_W}px`;
    world.style.height = `${cfg.worldH}px`;

    const zoneEls = new Map<Realm, HTMLElement>();
    if (cfg.zones) {
      for (const z of ZONES) {
        const zd = buildZone(z);
        world.appendChild(zd);
        zoneEls.set(z.id, zd);
      }
    }

    const edgeLayer = createEdgeLayer(boardImpl, WORLD_W, cfg.worldH);
    world.appendChild(edgeLayer.svg);

    const nodeEls = new Map<NodeId, HTMLDivElement>();
    const board: Board = {
      impl: boardImpl,
      root: container,
      viewport,
      world,
      inspectorEl: document.createElement('div'),
      edgeLayer,
      nodeEls,
      zoneEls,
      pos: clonePos(cfg.defKey),
    };

    for (const id of NODE_IDS) {
      const el = createNodeEl(id, {
        onPointerDown: (nid, e) => beginDrag(board, nid, el, e),
        onEnter: (nid) => onNodeEnter(board, nid),
        onLeave: (nid) => onNodeLeave(board, nid),
        onClick: (nid) => onNodeClick(board, nid),
      });
      nodeEls.set(id, el);
      world.appendChild(el);
    }

    const inspectorEl = board.inspectorEl;
    inspectorEl.className = 'exp-inspector';

    viewport.appendChild(world);
    viewport.appendChild(inspectorEl);
    container.appendChild(viewport);

    viewport.addEventListener('pointerdown', (e) => beginPan(board, e));

    return board;
  }

  function buildZone(z: ZoneDef): HTMLElement {
    const zd = document.createElement('div');
    zd.className = 'exp-zone';
    zd.setAttribute('data-zone', z.id);
    zd.style.left = `${z.x}px`;
    zd.style.width = `${z.w}px`;
    zd.style.setProperty('--zc', z.col);
    zd.innerHTML = `<div class="exp-zone-head"><div class="exp-zone-name" style="color:${z.col}">${z.name}</div><div class="exp-zone-sub">${z.sub}</div></div>`;
    return zd;
  }

  interface Realms {
    root: HTMLElement;
    lanes: HTMLElement;
    inspectorEl: HTMLElement;
  }

  function buildRealmsView(): Realms {
    const container = document.createElement('div');
    container.className = 'exp-board exp-realms';
    const lanes = document.createElement('div');
    lanes.className = 'exp-lanes';
    for (const rm of REALMS) {
      const lane = document.createElement('div');
      lane.className = 'exp-lane';
      lane.setAttribute('data-realm', rm.id);
      lane.style.setProperty('--rc', REALM_COL[rm.id]);
      const head = document.createElement('div');
      head.className = 'exp-lane-head';
      head.innerHTML =
        `<div class="exp-lane-name">${rm.name}</div>` + `<div class="exp-lane-sub">${rm.sub}</div>`;
      lane.appendChild(head);
      const cards = document.createElement('div');
      cards.className = 'exp-lane-cards';
      for (const id of rm.nodes) {
        cards.appendChild(buildLaneCard(id));
      }
      lane.appendChild(cards);
      lanes.appendChild(lane);
    }
    // Persist scroll across view switches (RealmsScroll memory).
    lanes.addEventListener('scroll', () => {
      realmsScroll.scrollLeft = lanes.scrollLeft;
      realmsScroll.scrollTop = lanes.scrollTop;
    });
    container.appendChild(lanes);

    const inspectorEl = document.createElement('div');
    inspectorEl.className = 'exp-inspector exp-inspector-realms';
    container.appendChild(inspectorEl);

    return { root: container, lanes, inspectorEl };
  }

  function buildLaneCard(id: NodeId): HTMLButtonElement {
    const meta = NODES[id];
    const rc = REALM_COL[meta.realm];
    const kind = KINDS[KIND_OF[id]];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'exp-lane-card';
    card.setAttribute('data-lane-node', id);
    card.setAttribute('aria-pressed', 'false');
    card.style.setProperty('--rc', rc);
    card.innerHTML =
      `<span class="exp-node-ico" style="color:${rc}; background:rgb(from ${rc} r g b / 0.12)">` +
      `${kindSvg(kind.icon, 14)}</span>` +
      `<span class="exp-lane-card-label">${meta.label}</span>`;
    card.addEventListener('pointerenter', () => onLaneEnter(id));
    card.addEventListener('pointerleave', () => onLaneLeave(id));
    card.addEventListener('click', () => onLaneClick(id));
    return card;
  }

  // ---- legend ----
  function buildLegendHtml(): string {
    const item = (inner: string): string => `<span class="exp-legend-item">${inner}</span>`;
    const line = (lbl: string, items: string): string =>
      `<div class="exp-legend-line"><span class="exp-legend-grp">${lbl}</span>${items}</div>`;

    let typeItems = '';
    for (const k of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
      const kd = KINDS[k];
      typeItems += item(`<span class="exp-legend-ico">${kindSvg(kd.icon, 14)}</span>${kd.label}`);
    }

    let realmItems = '';
    for (const r of REALM_LABELS) {
      realmItems += item(
        `<span class="exp-legend-sq" style="background:${REALM_COL[r.id]}"></span>${r.name}`,
      );
    }

    const edgeItems =
      item(
        '<svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" ' +
          'stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/></svg>import',
      ) +
      item(
        '<svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="19" y2="4" ' +
          'stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>' +
          '<path d="M19 1 L24 4 L19 7 Z" fill="rgba(255,255,255,0.55)"/></svg>data',
      ) +
      item(
        '<svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="19" y2="4" ' +
          'stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
          '<path d="M19 1 L24 4 L19 7 Z" fill="rgba(255,255,255,0.55)"/></svg>control',
      ) +
      item(
        '<svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="19" y2="4" ' +
          'stroke="var(--ac)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
          '<path d="M19 1 L24 4 L19 7 Z" fill="var(--ac)"/></svg>ipc',
      );

    return `<div class="exp-legend-bar">${line('type', typeItems)}${line('realm', realmItems)}${line('edge', edgeItems)}</div>`;
  }

  function mkCtrlBtn(cls: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    return b;
  }

  // ---- controls wiring ----
  resetBtn.addEventListener('click', () => {
    if (impl === 2) return;
    resetBoard(impl);
  });

  // ---- transform / centering ----
  function applyTransform(boardImpl: 1 | 3): void {
    const board = boards[boardImpl];
    const v = view[boardImpl];
    board.world.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.scale})`;
  }

  // boards whose pan has been auto-centred for the current viewport width.
  const centered = new Set<1 | 3>();

  // Approximate node box per id. DETERMINISTIC (not read from the DOM): centring
  // must not depend on offsetWidth, which is briefly wrong in dev while Vite is
  // still injecting CSS (the fixed-width rich cards measure huge unstyled) — that
  // race left the graph mis-centred on some loads.
  function nodeBox(id: NodeId): { w: number; h: number } {
    if (id === 'playground') return { w: 210, h: 150 };
    if (id === 'preview') return { w: 160, h: 120 };
    return { w: 162, h: 50 };
  }

  // Fit the node cluster into the viewport and centre it on both axes. Zoom is
  // gone (it hijacked page scroll), so this initial fit-scale is what keeps the
  // graph from clipping on narrow screens — it is not interactive zoom.
  function centerBoard(board: Board): void {
    const vpW = board.viewport.clientWidth;
    const vpH = board.viewport.clientHeight;
    if (vpW === 0) return; // hidden board — measure once it is shown
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // Nodes are centre-anchored on their position (CSS translate(-50%,-50%)),
    // so each spans pos ± half-size. Prefer the real measured size, but fall back
    // to the deterministic box when offsetWidth is missing or absurd — in dev the
    // fixed-width rich cards briefly measure huge before Vite injects their CSS.
    for (const id of NODE_IDS) {
      const p = board.pos[id];
      if (!p) continue;
      const def = nodeBox(id);
      const el = board.nodeEls.get(id);
      const mw = el?.offsetWidth ?? 0;
      const mh = el?.offsetHeight ?? 0;
      const w = mw >= 60 && mw <= 280 ? mw : def.w;
      const h = mh >= 24 && mh <= 220 ? mh : def.h;
      minX = Math.min(minX, p[0] - w / 2);
      maxX = Math.max(maxX, p[0] + w / 2);
      minY = Math.min(minY, p[1] - h / 2);
      maxY = Math.max(maxY, p[1] + h / 2);
    }
    if (!Number.isFinite(minX)) return;
    const PAD = 24;
    const contentW = maxX - minX;
    const s = Math.max(0.5, Math.min(1, (vpW - PAD * 2) / contentW));
    const v = view[board.impl];
    v.scale = s;
    v.tx = vpW / 2 - ((minX + maxX) / 2) * s;
    v.ty = vpH / 2 - ((minY + maxY) / 2) * s;
    applyTransform(board.impl);
    centered.add(board.impl);
  }

  function ensureCentered(boardImpl: 1 | 3): void {
    if (!centered.has(boardImpl)) centerBoard(boards[boardImpl]);
  }

  function resetBoard(boardImpl: 1 | 3): void {
    const board = boards[boardImpl];
    board.pos = clonePos(BOARDS[boardImpl].defKey);
    view[boardImpl] = defaultView();
    layoutBoard(board);
    centerBoard(board);
    drawBoardEdges(board);
    styleZones(board);
  }

  // ---- layout / sizes ----
  function layoutBoard(board: Board): void {
    for (const id of NODE_IDS) {
      const el = board.nodeEls.get(id);
      const p = board.pos[id];
      if (el && p) {
        el.style.left = `${p[0]}px`;
        el.style.top = `${p[1]}px`;
      }
    }
    applyTransform(board.impl);
  }

  function boardSizes(board: Board): Record<NodeId, NodeSize> {
    const sizes = {} as Record<NodeId, NodeSize>;
    for (const id of NODE_IDS) {
      const el = board.nodeEls.get(id);
      sizes[id] = el ? { hw: el.offsetWidth / 2, hh: el.offsetHeight / 2 } : { hw: 40, hh: 18 };
    }
    return sizes;
  }

  // ---- edge drawing ----
  function drawBoardEdges(board: Board): void {
    const ps = pathState();
    const edgeState: EdgePathState = {
      overview: ps.overview,
      doneEdges: ps.doneEdges,
      segEdges: ps.segEdges,
      allEdges: ps.allEdges,
      hover,
    };
    board.edgeLayer.redraw(board.pos, boardSizes(board), edgeState);
  }

  // ---- node styling ----
  function styleBoardNodes(board: Board): void {
    const ps = pathState();
    const neighbours = hover !== null ? ADJ.get(hover) : null;
    for (const id of NODE_IDS) {
      const el = board.nodeEls.get(id);
      if (!el) continue;
      const rich = RICH_NODES.has(id);
      el.setAttribute('aria-pressed', String(inspect === id));
      el.style.boxShadow = 'none';
      el.style.animation = '';
      let bg = '';
      let bd = '';
      let dim = false;
      if (hover !== null) {
        if (id === hover) {
          bg = 'rgb(from var(--ac) r g b / 0.16)';
          bd = 'var(--ac)';
          el.style.boxShadow = '0 0 0 1px var(--ac)';
        } else if (neighbours?.has(id)) {
          bd = 'rgb(from var(--ac) r g b / 0.5)';
        } else {
          dim = true;
        }
      } else if (id === ps.curNode) {
        bg = 'rgb(from var(--ac) r g b / 0.18)';
        bd = 'var(--ac)';
        el.style.boxShadow = '0 0 0 1px var(--ac)';
        el.style.animation = 'rfNodePulse 1.4s ease-out infinite';
      } else if (ps.segNodes.has(id)) {
        bg = 'rgb(from var(--ac) r g b / 0.11)';
        bd = 'var(--ac)';
      } else if (ps.touched.has(id)) {
        bg = 'rgb(from var(--ac) r g b / 0.08)';
        bd = 'rgb(from var(--ac) r g b / 0.5)';
      } else if (ps.allNodes.has(id)) {
        bg = 'rgb(from var(--ac) r g b / 0.035)';
        bd = 'rgb(from var(--ac) r g b / 0.34)';
      } else {
        dim = !ps.overview;
      }
      el.classList.toggle('exp-node-dim', dim);
      if (!rich) el.style.background = bg;
      // left border stays the realm color; recolor the other three sides.
      el.style.borderTopColor = bd;
      el.style.borderRightColor = bd;
      el.style.borderBottomColor = bd;
    }
  }

  // ---- zones (hybrid) ----
  function styleZones(board: Board): void {
    if (!BOARDS[board.impl].zones) return;
    const steps = trace();
    const cur = steps[step];
    let realm: Realm | null = cur ? NODES[cur.node].realm : null;
    if (realm === 'ext') realm = 'page';
    for (const z of ZONES) {
      const zd = board.zoneEls.get(z.id);
      if (!zd) continue;
      const on = z.id === realm;
      zd.classList.toggle('exp-zone-on', on);
    }
  }

  // ---- inspector ----
  function renderActiveInspector(inspectorEl: HTMLElement): void {
    const active = hover ?? inspect;
    renderInspector(inspectorEl, active);
    if (active === null) inspectorEl.replaceChildren();
  }

  function updateInspectorFor(board: Board): void {
    renderActiveInspector(board.inspectorEl);
  }

  // ---- per-board full render ----
  function renderBoard(board: Board): void {
    layoutBoard(board);
    updateSurfaces(board.world, scn);
    styleBoardNodes(board);
    drawBoardEdges(board);
    updateInspectorFor(board);
    styleZones(board);
  }

  // ---- realms view styling ----
  function renderRealms(): void {
    const ps = pathState();
    const cur = ps.curNode;
    // During scenario playback the realm lane owning the current node lights up;
    // in Whole-schema mode curNode is null, so no lane is active. ext (registry)
    // has no lane of its own — its card lives in the PAGE lane, so map ext→page
    // (mirrors styleZones for the hybrid view).
    let curRealm: Realm | null = cur ? NODES[cur].realm : null;
    if (curRealm === 'ext') curRealm = 'page';
    for (const lane of Array.from(realms.root.querySelectorAll<HTMLElement>('[data-realm]'))) {
      lane.classList.toggle('exp-lane-on', lane.dataset.realm === curRealm);
    }
    const neighbours = hover !== null ? ADJ.get(hover) : null;
    for (const card of Array.from(realms.root.querySelectorAll<HTMLElement>('[data-lane-node]'))) {
      const id = card.dataset.laneNode;
      if (id === undefined || !(id in NODES)) continue;
      const nid = id as NodeId;
      card.setAttribute('aria-pressed', String(inspect === nid));
      card.classList.remove('exp-lc-cur', 'exp-lc-touched', 'exp-lc-dim', 'exp-lc-part');
      if (hover !== null) {
        if (nid === hover) card.classList.add('exp-lc-cur');
        else if (neighbours?.has(nid)) card.classList.add('exp-lc-touched');
        else card.classList.add('exp-lc-dim');
      } else if (nid === ps.curNode) {
        card.classList.add('exp-lc-cur');
      } else if (ps.touched.has(nid)) {
        card.classList.add('exp-lc-touched');
      } else if (ps.allNodes.has(nid)) {
        card.classList.add('exp-lc-part');
      } else if (!ps.overview) {
        card.classList.add('exp-lc-dim');
      }
    }
    // Inspector mirrors the graph views: hover wins over the pinned node.
    renderActiveInspector(realms.inspectorEl);
    // Restore remembered scroll (set after display:'' so the element is laid out).
    realms.lanes.scrollLeft = realmsScroll.scrollLeft;
    realms.lanes.scrollTop = realmsScroll.scrollTop;
  }

  // ---- master sync ----
  function syncChrome(): void {
    // view switcher active
    for (const [n, btn] of switcherBtns) {
      const on = n === impl;
      btn.classList.toggle('exp-view-btn-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    // scenario chips
    for (const [id, chip] of chipEls) {
      const on = id === scn;
      chip.classList.toggle('exp-chip-on', on);
      chip.setAttribute('aria-pressed', String(on));
      const dot = chip.querySelector<HTMLElement>('.exp-chip-dot');
      if (dot) dot.classList.toggle('exp-chip-dot-play', on && playing);
    }
    // status row
    const overview = isOverview();
    const steps = trace();
    const stepDef = steps[step];
    if (titleEl) titleEl.textContent = curScn().label;
    if (captionEl) captionEl.textContent = overview ? OVERVIEW_CAPTION : (stepDef?.t ?? '');
    if (stepNumEl) {
      stepNumEl.style.display = overview ? 'none' : '';
      stepNumEl.textContent = `${step + 1} / ${steps.length}`;
    }
    if (fill) {
      fill.style.width = overview
        ? '0%'
        : `${(((step + 1) / Math.max(1, steps.length)) * 100).toFixed(3)}%`;
    }
  }

  function applyView(): void {
    syncChrome();
    // legend + canvas controls only apply to the two graph views.
    legendRow.style.display = impl === 2 ? 'none' : '';
    boards[1].root.style.display = impl === 1 ? '' : 'none';
    realms.root.style.display = impl === 2 ? '' : 'none';
    boards[3].root.style.display = impl === 3 ? '' : 'none';
    if (impl === 1) {
      ensureCentered(1);
      renderBoard(boards[1]);
    } else if (impl === 3) {
      ensureCentered(3);
      renderBoard(boards[3]);
    } else {
      renderRealms();
    }
  }

  // ---- interactions: state setters ----
  function setImpl(n: ImplId): void {
    hover = null;
    impl = n;
    applyView();
  }

  function setScn(id: ScnState): void {
    stopPlay();
    hover = null;
    if (id === 'none') {
      scn = 'none';
      step = 0;
      playing = false;
      applyView();
      return;
    }
    scn = id;
    step = 0;
    playing = true;
    applyView();
    scheduleTick();
  }

  function onChipClick(id: ScnState): void {
    if (id !== 'none' && id === scn) {
      // re-click active chip → replay
      replay();
      return;
    }
    setScn(id);
  }

  function replay(): void {
    stopPlay();
    hover = null;
    step = 0;
    playing = true;
    applyView();
    scheduleTick();
  }

  function stopPlay(): void {
    if (playTimer !== null) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  function scheduleTick(): void {
    stopPlay();
    playTimer = setTimeout(() => {
      playTimer = null;
      if (!playing) return;
      if (step >= trace().length - 1) {
        playing = false;
        syncChrome();
        return;
      }
      step += 1;
      applyView();
      if (playing) scheduleTick();
    }, STEP_MS);
  }

  // ---- interactions: hover / click / drag / pan ----
  function activeBoard(): Board | null {
    if (impl === 1) return boards[1];
    if (impl === 3) return boards[3];
    return null;
  }

  function clearSuppressedNodeClick(): void {
    if (suppressNodeClickTimer !== null) clearTimeout(suppressNodeClickTimer);
    suppressNodeClickTimer = null;
    suppressNodeClick = null;
  }

  function onNodeEnter(board: Board, id: NodeId): void {
    if (drag || pan) return;
    if (board.impl !== impl) return;
    hover = id;
    styleBoardNodes(board);
    drawBoardEdges(board);
    updateInspectorFor(board);
  }

  function onNodeLeave(board: Board, id: NodeId): void {
    if (hover !== id) return;
    hover = null;
    styleBoardNodes(board);
    drawBoardEdges(board);
    updateInspectorFor(board);
  }

  function onNodeClick(board: Board, id: NodeId): void {
    if (suppressNodeClick === id) {
      clearSuppressedNodeClick();
      return;
    }
    clearSuppressedNodeClick();
    // toggle the pin: click a pinned node again to release it.
    inspect = inspect === id ? null : id;
    styleBoardNodes(board);
    updateInspectorFor(board);
  }

  // ---- interactions: realms lane cards (same hover/pin model as graph nodes) ----
  function onLaneEnter(id: NodeId): void {
    if (impl !== 2) return;
    hover = id;
    renderRealms();
  }

  function onLaneLeave(id: NodeId): void {
    if (hover !== id) return;
    hover = null;
    renderRealms();
  }

  function onLaneClick(id: NodeId): void {
    inspect = inspect === id ? null : id;
    renderRealms();
  }

  function beginDrag(board: Board, id: NodeId, el: HTMLElement, e: PointerEvent): void {
    e.stopPropagation();
    clearSuppressedNodeClick();
    drag = {
      board,
      id,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    el.classList.add('exp-grabbing');
  }

  function beginPan(board: Board, e: PointerEvent): void {
    pan = { board, x: e.clientX, y: e.clientY };
    board.viewport.classList.add('exp-grabbing');
    // click on empty canvas dismisses a pinned inspector.
    if (inspect !== null && hover === null) {
      inspect = null;
      styleBoardNodes(board);
      updateInspectorFor(board);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (drag) {
      const { board } = drag;
      const s = view[board.impl].scale;
      const dx = (e.clientX - drag.x) / s;
      const dy = (e.clientY - drag.y) / s;
      const totalDx = (e.clientX - drag.startX) / s;
      const totalDy = (e.clientY - drag.startY) / s;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        drag.moved = true;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      const p = board.pos[drag.id];
      board.pos[drag.id] = [p[0] + dx, p[1] + dy];
      layoutBoard(board);
      drawBoardEdges(board);
    } else if (pan) {
      const { board } = pan;
      const v = view[board.impl];
      v.tx += e.clientX - pan.x;
      v.ty += e.clientY - pan.y;
      pan.x = e.clientX;
      pan.y = e.clientY;
      applyTransform(board.impl);
    }
  }

  function endPointerInteraction(suppressClick: boolean): void {
    clearSuppressedNodeClick();
    if (drag) {
      const el = drag.board.nodeEls.get(drag.id);
      if (el) el.classList.remove('exp-grabbing');
      if (suppressClick && drag.moved) {
        suppressNodeClick = drag.id;
        suppressNodeClickTimer = setTimeout(clearSuppressedNodeClick, 0);
      }
    }
    if (pan) pan.board.viewport.classList.remove('exp-grabbing');
    drag = null;
    pan = null;
  }

  window.addEventListener('pointermove', onPointerMove);
  const onPointerUp = (): void => endPointerInteraction(true);
  const onPointerCancel = (): void => endPointerInteraction(false);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  // ---- initial paint ----
  layoutBoard(boards[1]);
  layoutBoard(boards[3]);
  applyView();

  // After fonts/layout settle, re-measure node sizes so centering + edge
  // border-clips are accurate (offsetWidth is 0 before the element is laid out).
  function recenterActive(): void {
    const board = activeBoard();
    if (!board) return;
    centered.delete(board.impl);
    centerBoard(board);
    drawBoardEdges(board);
  }
  const rafId = requestAnimationFrame(recenterActive);
  const remeasureTimer = setTimeout(recenterActive, 380);

  // Re-centre on width change (responsive); drops any manual pan, which is fine.
  function onResize(): void {
    centered.clear();
    recenterActive();
  }
  window.addEventListener('resize', onResize);

  // ---- cleanup ----
  return () => {
    stopPlay();
    clearSuppressedNodeClick();
    cancelAnimationFrame(rafId);
    clearTimeout(remeasureTimer);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('resize', onResize);
  };
}
