// Interactive architecture explorer — "Poster / Dark". Chip bar → status →
// board → inspector. Hover = adjacency, click / Enter / Space = pin, chip =
// narrated scenario walked over BFS paths (./graph) at STEP_MS per step.
// Fixed 1180×660 design space scaled to the container; below MIN_SCALE the
// board pans horizontally instead of shrinking further.

import './explorer.css';
import {
  EDGES,
  type EdgeKind,
  NODES,
  type NodeId,
  REALM_COL,
  type Realm,
  SCN,
  SCN_NONE,
  type ScenarioId,
  ZONES,
} from './data';
import { bfsPath, buildAdjacency } from './graph';

const W = 1180;
const H = 660;
const MIN_SCALE = 0.62;
const STEP_MS = 1400;
// Edge lines end just outside each node's box (measured after mount), so short
// edges between neighbours never collapse into a stub and arrowheads stay visible.
const EDGE_GAP = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

const HINT =
  '// selected runtime topology — solid = import · arrow = data · dashed = control · dotted = ipc';
const IDLE_CAPTION =
  'Hover a module to see its links; click to pin its description. Pick a scenario to follow its narrated steps.';

const CHIPS: ReadonlyArray<readonly [ScenarioId, string]> = [
  ['boot', 'Boot'],
  ['npm', 'npm install'],
  ['express', 'Express + preview'],
  ['vite', 'Vite HMR'],
  ['wasi', 'Raw WASI'],
  ['sync', 'Child sync fs (SAB)'],
];

// Node centres in the 1180×660 design space (design handoff `POS`).
const POS: Record<NodeId, readonly [number, number]> = {
  playground: [135, 110],
  workbench: [90, 225],
  terminal: [180, 300],
  sdk: [90, 390],
  sandboxvfs: [180, 480],
  owner: [395, 105],
  kernel: [635, 105],
  vfs: [395, 200],
  sab: [635, 200],
  shell: [395, 295],
  npm: [635, 295],
  runtimejs: [395, 390],
  runtimewasi: [635, 390],
  esbuild: [395, 485],
  vite: [635, 485],
  net: [395, 580],
  httpserver: [635, 580],
  sw: [810, 335],
  preview: [955, 430],
  registry: [1080, 230],
};

const ADJ = buildAdjacency(EDGES);
const NODE_IDS = Object.keys(NODES) as NodeId[];
const ZONE_NAME = new Map<Realm, string>(ZONES.map((zone) => [zone.id, zone.name]));

type NodeState = 'cur' | 'nb' | 'tc' | 'dim' | null;
type EdgeState = 'hot' | 'mute' | 'seg' | 'done' | 'path' | 'off' | null;

interface State {
  scn: ScenarioId | null;
  step: number;
  hover: NodeId | null;
  pin: NodeId | null;
}

// One scenario step = the BFS path from the previous step's node (exclusive).
interface Segment {
  nodes: NodeId[];
  edges: string[];
}

interface Flow {
  cur: NodeId;
  touched: Set<NodeId>;
  onPath: Set<NodeId>;
  segEdges: Set<string>;
  doneEdges: Set<string>;
  allEdges: Set<string>;
}

interface EdgeRef {
  a: NodeId;
  b: NodeId;
  kind: EdgeKind;
  key: string;
  line: SVGLineElement;
}

function edgeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function segmentsOf(id: ScenarioId): Segment[] {
  const segs: Segment[] = [];
  let prev: NodeId | null = null;
  for (const step of SCN[id].steps) {
    const path = prev === null ? [step.node] : bfsPath(ADJ, prev, step.node);
    const seg: Segment = { nodes: prev === null ? [step.node] : [], edges: [] };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a === undefined || b === undefined) continue;
      seg.nodes.push(b);
      seg.edges.push(edgeKey(a, b));
    }
    segs.push(seg);
    prev = step.node;
  }
  return segs;
}

const SEGS = new Map<ScenarioId, Segment[]>(CHIPS.map(([id]) => [id, segmentsOf(id)]));

function flowOf(scn: ScenarioId, step: number): Flow | null {
  const cur = SCN[scn].steps[step]?.node;
  if (cur === undefined) return null;
  const segs = SEGS.get(scn) ?? [];
  const flow: Flow = {
    cur,
    touched: new Set(),
    onPath: new Set(),
    segEdges: new Set(segs[step]?.edges ?? []),
    doneEdges: new Set(),
    allEdges: new Set(),
  };
  segs.forEach((seg, i) => {
    for (const n of seg.nodes) {
      flow.onPath.add(n);
      if (i <= step) flow.touched.add(n);
    }
    for (const e of seg.edges) {
      flow.allEdges.add(e);
      if (i <= step) flow.doneEdges.add(e);
    }
  });
  return flow;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function nodeIdOf(target: EventTarget | null): NodeId | null {
  if (!(target instanceof Element)) return null;
  const host = target.closest<HTMLElement>('[data-node]');
  const id = host?.dataset.node;
  return id !== undefined && id in NODES ? (id as NodeId) : null;
}

function buildZone(realm: Realm, name: string, sub: string, x: number, w: number): HTMLElement {
  const zone = el('div', 'exp-zone');
  zone.dataset.zone = realm;
  zone.style.left = `${x}px`;
  zone.style.width = `${w}px`;
  const head = el('div', 'exp-zhead');
  const title = el('div', 'exp-zname', name);
  title.style.color = REALM_COL[realm];
  const subEl = el('div', 'exp-zsub', sub);
  subEl.setAttribute('aria-hidden', 'true');
  head.append(title, subEl);
  zone.append(head);
  return zone;
}

function buildMarker(id: string, cls: string): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.id = id;
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M0 0L8 4L0 8Z');
  path.setAttribute('class', cls);
  marker.append(path);
  return marker;
}

function buildLine(kind: EdgeKind): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line');
  if (kind === 'control') line.setAttribute('stroke-dasharray', '5 4');
  if (kind === 'ipc') line.setAttribute('stroke-dasharray', '3 4');
  line.dataset.kind = kind;
  return line;
}

// Point where the centre-to-centre ray leaves node `from`'s box (plus EDGE_GAP).
function borderPoint(from: NodeId, to: NodeId, half: [number, number]): [number, number] {
  const [cx, cy] = POS[from];
  const [tx, ty] = POS[to];
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const k = 1 / Math.max(Math.abs(dx) / (half[0] + EDGE_GAP), Math.abs(dy) / (half[1] + EDGE_GAP));
  return [cx + dx * Math.min(k, 0.5), cy + dy * Math.min(k, 0.5)];
}

function buildNode(id: NodeId): HTMLElement {
  const def = NODES[id];
  const [x, y] = POS[id];
  const node = el('div', 'exp-node');
  node.dataset.node = id;
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.setAttribute('aria-label', def.label);
  node.setAttribute('aria-pressed', 'false');
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.setProperty('--realm', REALM_COL[def.realm]);
  node.append(el('span', 'exp-node-label', def.label));
  if (def.compat === 'warn') {
    const warn = el('span', 'exp-node-warn', '⚠');
    warn.setAttribute('aria-hidden', 'true');
    node.append(warn);
  }
  return node;
}

function nodeCard(id: NodeId): HTMLElement[] {
  const def = NODES[id];
  const realm = el('span', 'exp-ins-realm', ZONE_NAME.get(def.realm) ?? def.realm.toUpperCase());
  realm.style.color = REALM_COL[def.realm];
  return [el('span', 'exp-ins-name', def.label), realm, el('span', 'exp-ins-role', def.role)];
}

export function mountExplorer(root: HTMLElement): () => void {
  const state: State = { scn: null, step: 0, hover: null, pin: null };
  let timer: ReturnType<typeof setTimeout> | undefined;

  // ---- chip bar ----
  const bar = el('div', 'exp-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Scenario');
  const barLabel = el('span', 'exp-bar-lbl', 'SCENARIO');
  barLabel.setAttribute('aria-hidden', 'true');
  bar.append(barLabel);
  const chips = new Map<ScenarioId | 'none', HTMLButtonElement>();
  const addChip = (id: ScenarioId | 'none', label: string): void => {
    const chip = el('button', 'exp-chip', label);
    chip.type = 'button';
    chip.dataset.scn = id;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => run(id === 'none' ? null : id));
    chips.set(id, chip);
    bar.append(chip);
  };
  addChip('none', SCN_NONE.label);
  for (const [id, label] of CHIPS) addChip(id, label);

  // ---- status ----
  const status = el('div', 'exp-status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const statusRow = el('div', 'exp-st-row');
  const title = el('span', 'exp-st-title');
  title.dataset.scnTitle = '';
  const num = el('span', 'exp-st-num');
  num.dataset.stepNum = '';
  statusRow.append(title, num);
  const caption = el('div', 'exp-st-cap');
  caption.dataset.stepCaption = '';
  const progress = el('div', 'exp-progress');
  progress.setAttribute('aria-hidden', 'true');
  const fill = el('i', 'exp-progress-fill');
  progress.append(fill);
  status.append(statusRow, caption, progress);

  // ---- board ----
  const board = el('div', 'exp-board');
  const stage = el('div', 'exp-stage');
  const world = el('div', 'exp-world');
  stage.append(world);
  board.append(stage);

  const zones = new Map<Realm, HTMLElement>();
  ZONES.forEach((zone, i) => {
    const z = buildZone(zone.id, zone.name, zone.sub, zone.x, zone.w);
    if (i === ZONES.length - 1) z.classList.add('exp-zone-last');
    zones.set(zone.id, z);
    world.append(z);
  });

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'exp-edges');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.append(buildMarker('exp-mk-grey', 'exp-mk-grey'), buildMarker('exp-mk-lime', 'exp-mk-lime'));
  svg.append(defs);
  const edges: EdgeRef[] = EDGES.map((e) => {
    const line = buildLine(e.kind);
    svg.append(line);
    return { a: e.from, b: e.to, kind: e.kind, key: edgeKey(e.from, e.to), line };
  });
  world.append(svg);

  const nodes = new Map<NodeId, HTMLElement>();
  for (const id of NODE_IDS) {
    const node = buildNode(id);
    nodes.set(id, node);
    world.append(node);
  }

  world.addEventListener('pointerover', (e) => {
    const id = nodeIdOf(e.target);
    if (id === null || id === state.hover) return;
    state.hover = id;
    paint();
  });
  world.addEventListener('pointerout', (e) => {
    const id = nodeIdOf(e.target);
    if (id === null || id !== state.hover || nodeIdOf(e.relatedTarget) === id) return;
    state.hover = null;
    paint();
  });
  world.addEventListener('click', (e) => {
    const id = nodeIdOf(e.target);
    if (id !== null) togglePin(id);
  });
  world.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const id = nodeIdOf(e.target);
    if (id === null) return;
    e.preventDefault();
    togglePin(id);
  });

  // ---- inspector ----
  const inspector = el('div', 'exp-inspector');
  const hint = el('span', 'exp-hint', HINT);
  hint.setAttribute('aria-hidden', 'true');

  const host = el('div', 'exp');
  host.append(bar, status, board, inspector);
  root.replaceChildren(host);

  // ---- behaviour ----
  function togglePin(id: NodeId): void {
    state.pin = state.pin === id ? null : id;
    paint();
  }

  function stop(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function run(id: ScenarioId | null): void {
    stop();
    state.hover = null;
    state.scn = id;
    state.step = 0;
    tick();
  }

  function tick(): void {
    paint();
    const scn = state.scn;
    if (scn === null || state.step >= SCN[scn].steps.length - 1) return;
    timer = setTimeout(() => {
      state.step += 1;
      tick();
    }, STEP_MS);
  }

  function paintStatus(): void {
    const scn = state.scn;
    if (scn === null) {
      title.textContent = SCN_NONE.label;
      num.textContent = '';
      caption.textContent = IDLE_CAPTION;
      fill.style.width = '0%';
      return;
    }
    const s = SCN[scn];
    title.textContent = s.label;
    num.textContent = `${state.step + 1} / ${s.steps.length} · $ ${s.cmd}`;
    caption.textContent = s.steps[state.step]?.t ?? '';
    fill.style.width = `${((state.step + 1) / s.steps.length) * 100}%`;
  }

  function nodeState(id: NodeId, flow: Flow | null): NodeState {
    const hover = state.hover;
    if (hover !== null) {
      if (id === hover) return 'cur';
      return ADJ.get(hover)?.has(id) ? 'nb' : 'dim';
    }
    if (flow === null) return null;
    if (id === flow.cur) return 'cur';
    if (flow.touched.has(id)) return 'tc';
    return flow.onPath.has(id) ? 'nb' : 'dim';
  }

  function edgeState(edge: EdgeRef, flow: Flow | null): EdgeState {
    const hover = state.hover;
    if (hover !== null) return edge.a === hover || edge.b === hover ? 'hot' : 'mute';
    if (flow === null) return null;
    if (flow.segEdges.has(edge.key)) return 'seg';
    if (flow.doneEdges.has(edge.key)) return 'done';
    return flow.allEdges.has(edge.key) ? 'path' : 'off';
  }

  function paint(): void {
    const { scn, hover, pin } = state;
    const flow = scn === null ? null : flowOf(scn, state.step);
    for (const [id, chip] of chips) {
      chip.setAttribute('aria-pressed', String((scn ?? 'none') === id));
    }
    paintStatus();

    const curRealm = flow === null ? null : NODES[flow.cur].realm;
    for (const [realm, zone] of zones) zone.classList.toggle('exp-zone-on', realm === curRealm);

    for (const [id, node] of nodes) {
      const st = nodeState(id, flow);
      node.className = `exp-node${st === null ? '' : ` exp-node-${st}`}${pin === id ? ' exp-node-pin' : ''}`;
      node.setAttribute('aria-pressed', String(pin === id));
    }

    for (const edge of edges) {
      const st = edgeState(edge, flow);
      edge.line.setAttribute('class', `exp-edge${st === null ? '' : ` exp-edge-${st}`}`);
      if (edge.kind === 'import') continue;
      const lime = st === 'hot' || st === 'seg' || st === 'done';
      edge.line.setAttribute('marker-end', lime ? 'url(#exp-mk-lime)' : 'url(#exp-mk-grey)');
    }

    const shown = hover ?? pin ?? flow?.cur ?? null;
    inspector.replaceChildren(...(shown === null ? [hint] : nodeCard(shown)));
  }

  // ---- edge geometry (needs node boxes; re-run once web fonts settle) ----
  function layoutEdges(): void {
    const half = (id: NodeId): [number, number] => {
      const node = nodes.get(id);
      const w = node?.offsetWidth ?? 0;
      const h = node?.offsetHeight ?? 0;
      return w > 0 && h > 0 ? [w / 2, h / 2] : [56, 14];
    };
    for (const edge of edges) {
      const [x1, y1] = borderPoint(edge.a, edge.b, half(edge.a));
      const [x2, y2] = borderPoint(edge.b, edge.a, half(edge.b));
      edge.line.setAttribute('x1', String(x1));
      edge.line.setAttribute('y1', String(y1));
      edge.line.setAttribute('x2', String(x2));
      edge.line.setAttribute('y2', String(y2));
    }
  }
  layoutEdges();
  let fontsSettled = true;
  void document.fonts.ready.then(() => {
    if (fontsSettled) layoutEdges();
  });

  // ---- responsive scale ----
  function fit(): void {
    const width = board.clientWidth;
    if (!width) return;
    const raw = width / W;
    const scale = Math.max(MIN_SCALE, Math.min(1, raw));
    world.style.transform = `scale(${scale})`;
    stage.style.width = `${W * scale}px`;
    stage.style.height = `${H * scale}px`;
    board.classList.toggle('exp-board-scroll', raw < MIN_SCALE);
  }
  const resize = new ResizeObserver(fit);
  resize.observe(board);
  fit();
  paint();

  return () => {
    stop();
    fontsSettled = false;
    resize.disconnect();
    host.remove();
  };
}
