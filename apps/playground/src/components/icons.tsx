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
  | 'corner-down-left'
  | 'file-output'
  | 'external-link'
  | 'x'
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'file-text'
  | 'code'
  | 'lock'
  | 'rotate-ccw'
  | 'check'
  | 'users'
  | 'plus'
  | 'file-plus'
  | 'folder-plus'
  | 'ellipsis'
  | 'github'
  | 'circle-check'
  | 'pencil-to-square'
  | 'arrow-rotate-left'
  | 'trash-bin'
  | 'triangle-exclamation-fill'
  | 'database'
  | 'clock'
  | 'box'
  | 'ellipsis-vertical'
  | 'circles-3-plus'
  | 'file-arrow-down';

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
  'corner-down-left': 'M20 4v7a4 4 0 0 1-4 4H4 M9 10l-5 5 5 5',
  'file-output':
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M2 15h10 M9 18l3-3-3-3',
  'external-link': 'M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  x: 'M18 6 6 18 M6 6l12 12',
  folder:
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  'folder-open':
    'm6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4',
  'file-text':
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M16 13H8 M16 17H8 M10 9H8',
  code: 'm16 18 6-6-6-6 M8 6l-6 6 6 6',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
  check: 'M20 6 9 17l-5-5',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  plus: 'M5 12h14 M12 5v14',
  'file-plus':
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M9 15h6 M12 12v6',
  'folder-plus':
    'M12 10v6 M9 13h6 M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  ellipsis: 'M12 12h.01 M19 12h.01 M5 12h.01',
  // GitHub mark (Simple Icons, CC0) — filled like `play`.
  github:
    'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.9.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.86l-.01 2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2z',
  'circle-check': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9 12l2 2 4-4',
  'pencil-to-square':
    'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  'arrow-rotate-left': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
  'trash-bin':
    'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  'triangle-exclamation-fill':
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  database:
    'M12 8c5 0 9-1.34 9-3s-4-3-9-3-9 1.34-9 3 4 3 9 3z M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5 M3 12c0 1.66 4 3 9 3s9-1.34 9-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12',
  'ellipsis-vertical': 'M12 12h.01 M12 5h.01 M12 19h.01',
  'circles-3-plus': 'M5 12h14 M12 5v14',
  'file-arrow-down':
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M12 12v6 M9 15l3 3 3-3',
};

/** Inline SVG icon. Inherits colour via `currentColor`; sized by `size` (px). */
export function Icon(props: { name: IconName; size?: number; class?: string }): JSX.Element {
  const size = (): number => props.size ?? 18;
  const filled = (): boolean =>
    props.name === 'play' || props.name === 'github' || props.name === 'triangle-exclamation-fill';
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
