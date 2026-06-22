/**
 * Top-bar project-switcher chip (design §1; ADR-0165 §9). A LAUNCHER TRIGGER, not
 * a gallery — the single gallery now lives in the launcher's Starters tab, so the
 * `view-templates`/`gallery` selectors do NOT appear here. Tokens: glyph tile
 * 20x20 radius 5 bg rgba(255,255,255,0.07), name 12.5px rgba(255,255,255,0.85),
 * dirty dot 6x6 #FFBE5C, chevron 11px. Dirty -> bg rgba(199,240,90,0.10) / border
 * rgba(199,240,90,0.35); clean -> rgba(255,255,255,0.06) / 0.08.
 */
import { Show } from 'solid-js';
import { Icon } from './icons.tsx';

export function ProjectSwitcherChip(props: {
  name: string;
  glyph: string;
  glyphColor: string;
  dirty: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      class="rf-chip"
      data-action="open-launcher"
      data-dirty={props.dirty}
      title="Open the project launcher"
      onClick={() => props.onOpen()}
    >
      <span class="rf-chip__tile" style={{ color: props.glyphColor }} aria-hidden="true">
        {props.glyph}
      </span>
      <span class="rf-chip__name">{props.name}</span>
      <Show when={props.dirty}>
        <span class="rf-chip__dot" aria-hidden="true" />
      </Show>
      <span class="rf-chip__chev" aria-hidden="true">
        <Icon name="chevron-down" size={11} />
      </span>
    </button>
  );
}
