import { For, Show } from 'solid-js';
import { CATEGORY_ORDER, PRESETS, type Preset } from '../presets.ts';

/**
 * Left-rail preset gallery. Presets are grouped by category (in
 * {@link CATEGORY_ORDER}) and rendered as clickable tiles; the active tile is
 * highlighted via `data-active`. Selecting a tile is the only thing this
 * component does — the mode transition (REPL / dev / real-vite) lives in the
 * caller's `onSelect`, so the gallery stays presentational.
 */
export function PresetGallery(props: {
  activeId: string;
  onSelect(preset: Preset): void;
}) {
  const byCategory = (category: string): Preset[] => PRESETS.filter((p) => p.category === category);

  return (
    <aside class="rf-gallery" data-testid="gallery">
      <div class="rf-gallery__head">
        <span class="rf-gallery__title">Presets</span>
        <span class="rf-gallery__hint">click to load &amp; run</span>
      </div>

      <div class="rf-gallery__scroll">
        <For each={CATEGORY_ORDER}>
          {(category) => (
            <Show when={byCategory(category).length > 0}>
              <div class="rf-cat">{category}</div>
              <For each={byCategory(category)}>
                {(preset) => (
                  <button
                    type="button"
                    class="rf-preset"
                    data-active={props.activeId === preset.id}
                    data-preset={preset.id}
                    onClick={() => props.onSelect(preset)}
                    aria-pressed={props.activeId === preset.id}
                  >
                    <span class="rf-preset__icon" aria-hidden="true">
                      {preset.icon}
                    </span>
                    <span class="rf-preset__body">
                      <span class="rf-preset__label">
                        {preset.label}
                        <Show when={preset.tag}>
                          {(tag) => (
                            <span class="rf-preset__tag" data-tone={tag().tone}>
                              {tag().text}
                            </span>
                          )}
                        </Show>
                      </span>
                      <span class="rf-preset__blurb">{preset.blurb}</span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          )}
        </For>
      </div>

      <div class="rf-gallery__foot">
        <span>Node + npm, in the browser</span>
        <a href="https://github.com/vanilla-wave/rifty" target="_blank" rel="noopener noreferrer">
          GitHub ↗
        </a>
      </div>
    </aside>
  );
}
