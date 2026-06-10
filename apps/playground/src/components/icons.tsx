/**
 * Monochrome inline-SVG icon set for the playground shell.
 *
 * Why vendored (not an icon library): rifty's zero-dep bias (CLAUDE.md) — the
 * 2026-06-04 library-fit review concluded that an icon dep (`lucide-solid`,
 * `@vscode/codicons`) is not worth a runtime dependency for ~10 glyphs. We copy
 * the SVG path data instead. Paths below are from Lucide (ISC License,
 * © Lucide Contributors — https://lucide.dev), redrawn as `currentColor`
 * strokes so they inherit the theme accent and never clash with it (the emoji
 * glyphs they replace rendered in full colour and looked out of place in the
 * monochrome "terminal-luxe" theme — ADR-0073).
 *
 * Add a new template? Pick an existing {@link IconName} or add one path here —
 * presets declare a semantic icon key (see {@link ../presets.ts}), never a raw
 * glyph, so the gallery scales to many templates with a consistent look.
 */
import type { JSX } from 'solid-js';

export type IconName =
  | 'play'
  | 'repeat'
  | 'package'
  | 'filesystem'
  | 'zap'
  | 'rocket'
  | 'terminal'
  | 'layers'
  | 'search'
  | 'history'
  | 'chevron-up'
  | 'chevron-down'
  | 'copy'
  | 'x';

/** Path data (Lucide, ISC). `play` is a filled glyph; the rest are strokes. */
const PATHS: Record<IconName, string> = {
  play: 'M6 3.5v17l14-8.5z',
  repeat: 'M17 2l4 4-4 4 M3 11V10a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v1a4 4 0 0 1-4 4H3',
  package:
    'M16.5 9.4 7.5 4.21 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12',
  filesystem:
    'M22 12H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M6 16h.01 M10 16h.01',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  rocket:
    'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  layers: 'M12 2 2 7l10 5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  search: 'M21 21l-4.34-4.34 M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 3v6h6 M12 7v5l3 2',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  copy: 'M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2',
  x: 'M18 6 6 18 M6 6l12 12',
};

/** Inline SVG icon. Inherits colour via `currentColor`; sized by `size` (px). */
export function Icon(props: { name: IconName; size?: number; class?: string }): JSX.Element {
  const size = (): number => props.size ?? 18;
  const filled = (): boolean => props.name === 'play';
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={filled() ? 'currentColor' : 'none'}
      stroke={filled() ? 'none' : 'currentColor'}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}
