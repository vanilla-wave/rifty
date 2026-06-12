/**
 * Top-bar project-template switcher (Soft Panels redesign) — replaces the old
 * sidebar PresetGallery. Chip shows the active template's glyph badge + id;
 * the dropdown lists every preset with label, blurb, and a lime check.
 * Disclosure pattern: button + aria-expanded, rows are toggle buttons; focus
 * returns to the chip whenever the menu closes.
 *
 * Keeps the e2e contract from the gallery (m10-hmr.spec.ts): the trigger is
 * `[data-action="view-templates"]`, the open dropdown is
 * `[data-testid="gallery"]`, rows are `[data-preset="<id>"]`.
 */
import { For, Show, createSignal } from 'solid-js';
import { DEFAULT_PRESET, PRESETS, type Preset, type PresetSetup } from '../presets.ts';
import { Icon } from './icons.tsx';

const FALLBACK_GLYPH_COLOR = 'rgba(255,255,255,0.7)';

/** Dropdown sections — one per sandbox setup kind (ADR-0135). */
const SETUP_GROUPS: ReadonlyArray<{ readonly setup: PresetSetup; readonly head: string }> = [
  { setup: 'instant', head: 'Instant start' },
  { setup: 'from-scratch', head: 'From scratch (npm install)' },
];

export function TemplateSwitcher(props: {
  activeId: string;
  onSelect(preset: Preset): void;
}) {
  const [open, setOpen] = createSignal(false);
  let chipEl: HTMLButtonElement | undefined;
  const active = (): Preset => PRESETS.find((p) => p.id === props.activeId) ?? DEFAULT_PRESET;
  const glyphText = (p: Preset): string => p.glyph?.text ?? p.label.slice(0, 1).toUpperCase();
  const glyphColor = (p: Preset): string => p.glyph?.color ?? FALLBACK_GLYPH_COLOR;

  function close(refocus = true): void {
    setOpen(false);
    if (refocus) chipEl?.focus();
  }

  function pick(preset: Preset): void {
    close();
    props.onSelect(preset);
  }

  return (
    <div
      class="rf-tpl"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open()) {
          e.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={chipEl}
        type="button"
        class="rf-tpl__chip"
        data-action="view-templates"
        aria-expanded={open()}
        title="Switch project template"
        onClick={() => (open() ? close() : setOpen(true))}
      >
        <span class="rf-tpl__badge" style={{ color: glyphColor(active()) }} aria-hidden="true">
          {glyphText(active())}
        </span>
        <span class="rf-tpl__name">{active().id}</span>
        <span class="rf-tpl__chev" aria-hidden="true">
          <Icon name="chevron-down" size={11} />
        </span>
      </button>
      <Show when={open()}>
        <div class="rf-tpl__menu" data-testid="gallery" aria-label="Project template">
          <For each={SETUP_GROUPS}>
            {(group) => (
              <>
                <div class="rf-tpl__menuhead">{group.head}</div>
                <For each={PRESETS.filter((preset) => preset.setup === group.setup)}>
                  {(preset) => (
                    <button
                      type="button"
                      class="rf-tpl__row"
                      data-preset={preset.id}
                      data-setup={preset.setup}
                      data-active={preset.id === props.activeId}
                      aria-pressed={preset.id === props.activeId}
                      onClick={() => pick(preset)}
                    >
                      <span
                        class="rf-tpl__rowbadge"
                        style={{ color: glyphColor(preset) }}
                        aria-hidden="true"
                      >
                        {glyphText(preset)}
                      </span>
                      <span class="rf-tpl__rowtext">
                        <span class="rf-tpl__rowtitle">
                          <span class="rf-tpl__rowlabel">{preset.label}</span>
                          <Show when={preset.tag} keyed>
                            {(tag) => (
                              <span class="rf-tpl__rowtag" data-tone={tag.tone}>
                                {tag.text}
                              </span>
                            )}
                          </Show>
                        </span>
                        <span class="rf-tpl__rowsub">{preset.blurb}</span>
                      </span>
                      <span class="rf-tpl__check" aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
          <div class="rf-tpl__foot">Switching restarts the dev server with the template files</div>
        </div>
        {/* Outside-click catcher; after the menu in DOM and out of the Tab
            order so keyboard users reach the rows first (Escape closes). */}
        <button
          type="button"
          class="rf-tpl__overlay"
          aria-label="Close template menu"
          tabindex="-1"
          onClick={() => close(false)}
        />
      </Show>
    </div>
  );
}
