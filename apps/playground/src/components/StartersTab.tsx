/**
 * Launcher Starters tab = THE single gallery (ADR-0079 + ADR-0165 §9). The e2e
 * contract selectors live HERE now (moved out of the deleted TemplateSwitcher):
 * `data-action="view-templates"` (the tab marker), `data-testid="gallery"` (the
 * grid), `data-preset="<id>"` (rows). Grouped FRONT-END / SERVER / WASM; empty
 * groups hidden under search/filter. Picking spins a fresh scratch (pickStarter).
 *
 * Cross-Phase Reconciliation A: the canonical `Starter` (glue/starter.ts) is the
 * seed/lifecycle entity (id/name/files); the gallery-display fields
 * (label/blurb/glyph/setup/category) live on `Preset`. So the gallery renders
 * straight from `Preset[]` and derives its launcher group via
 * `GROUP_FOR_CATEGORY[preset.category]` — never a deep-copied display Starter.
 */
import { For, Show } from 'solid-js';
import { type StarterGroup, groupForPreset } from '../glue/starter.ts';
import type { Preset } from '../presets.ts';
import { Icon } from './icons.tsx';

const FALLBACK_GLYPH_COLOR = 'rgba(255,255,255,0.7)';
const GROUPS: ReadonlyArray<{ id: StarterGroup; label: string; note: string }> = [
  { id: 'frontend', label: 'FRONT-END', note: 'Vite dev server' },
  { id: 'server', label: 'SERVER', note: 'Node 22 runtime' },
  { id: 'wasm', label: 'WASM', note: 'WASI preview1' },
];
const CATS: ReadonlyArray<{ id: 'all' | StarterGroup; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'frontend', label: 'Front-end' },
  { id: 'server', label: 'Server' },
  { id: 'wasm', label: 'Wasm' },
];

const groupOf = (p: Preset): StarterGroup => groupForPreset(p);

export function StartersTab(props: {
  presets: readonly Preset[];
  q: string;
  cat: 'all' | StarterGroup;
  ownerBlocked: boolean;
  onPick(id: string): void;
  onSearch(q: string): void;
  onCat(cat: 'all' | StarterGroup): void;
}) {
  const lq = (): string => props.q.trim().toLowerCase();
  const matches = (p: Preset): boolean =>
    (props.cat === 'all' || groupOf(p) === props.cat) &&
    (!lq() || `${p.label} ${p.id}`.toLowerCase().includes(lq()));
  const groups = (): ReadonlyArray<{ label: string; note: string; items: Preset[] }> =>
    GROUPS.map((g) => ({
      label: g.label,
      note: g.note,
      items: props.presets.filter((p) => groupOf(p) === g.id && matches(p)),
    })).filter((g) => g.items.length > 0);
  const glyphText = (p: Preset): string => p.glyph?.text ?? p.label.slice(0, 1).toUpperCase();
  const glyphColor = (p: Preset): string => p.glyph?.color ?? FALLBACK_GLYPH_COLOR;

  return (
    <div class="rf-starters" data-action="view-templates">
      <div class="rf-starters__cats">
        <For each={CATS}>
          {(c) => (
            <button
              type="button"
              class="rf-starters__cat"
              data-active={props.cat === c.id}
              onClick={() => props.onCat(c.id)}
            >
              {c.label}
            </button>
          )}
        </For>
      </div>
      <div class="rf-starters__grid" data-testid="gallery" aria-label="Starters">
        <For each={groups()}>
          {(group) => (
            <>
              <div class="rf-starters__head">
                <span class="rf-starters__headlabel">{group.label}</span>
                <span class="rf-starters__headnote">{group.note}</span>
              </div>
              <For each={group.items}>
                {(p) => (
                  <button
                    type="button"
                    class="rf-starters__card"
                    data-preset={p.id}
                    data-setup={p.setup}
                    disabled={props.ownerBlocked}
                    onClick={() => props.onPick(p.id)}
                  >
                    <span
                      class="rf-starters__tile"
                      style={{ color: glyphColor(p) }}
                      aria-hidden="true"
                    >
                      {glyphText(p)}
                    </span>
                    <span class="rf-starters__label">{p.label}</span>
                    <span class="rf-starters__blurb">{p.blurb}</span>
                    <Show
                      when={p.setup === 'instant'}
                      fallback={
                        <span class="rf-starters__setup">
                          <Icon name="box" size={11} /> npm install
                        </span>
                      }
                    >
                      <span class="rf-starters__setup" data-instant>
                        instant boot
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
