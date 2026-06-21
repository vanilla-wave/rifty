// Bottom-left inspector card. Shows the hovered (or pinned) node: label, kind,
// realm text, role, and depends-on / used-by derived from EDGES.

import { EDGES, KINDS, KIND_OF, NODES, type NodeId, REALM_COL, type Realm } from './data';

function realmText(r: Realm): string {
  if (r === 'page') return 'page';
  if (r === 'worker') return 'worker';
  if (r === 'sw') return 'service-worker';
  if (r === 'iframe') return 'preview iframe';
  return 'registry · egress';
}

function kindSvg(paths: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function row(label: string, items: string[]): string {
  if (items.length === 0) return '';
  return `<div class="exp-ins-row"><span class="exp-ins-row-label">${label}</span><div class="exp-ins-row-val">${items.join(', ')}</div></div>`;
}

// Render inspector content for `id` (hover takes precedence over pin upstream).
// Hidden when `id` is null.
export function renderInspector(el: HTMLElement, id: NodeId | null): void {
  if (id === null) {
    el.style.display = 'none';
    return;
  }
  const meta = NODES[id];
  const rc = REALM_COL[meta.realm];
  const kind = KINDS[KIND_OF[id]];
  const dependsOn = EDGES.filter((e) => e.from === id).map(
    (e) => `${NODES[e.to].label} (${e.kind})`,
  );
  const usedBy = EDGES.filter((e) => e.to === id).map((e) => NODES[e.from].label);

  const ico = kindSvg(kind.icon, 16);
  el.style.display = 'block';
  el.innerHTML = `<div class="exp-ins-head"><span class="exp-ins-ico" style="color:${rc}; background:rgb(from ${rc} r g b / 0.14)">${ico}</span><div><div class="exp-ins-label">${meta.label}</div><div class="exp-ins-sub">${kind.label} · runs in ${realmText(meta.realm)}</div></div></div><div class="exp-ins-role">${meta.role}</div>${row('depends on', dependsOn)}${row('used by', usedBy)}`;
}
