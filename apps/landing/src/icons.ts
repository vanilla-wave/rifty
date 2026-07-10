// Inline-SVG icon library for the rifty.dev landing.
// Self-contained: imports nothing. Source of truth = docs/landing/handoff/*.dc.html.
// Line icons: viewBox 0 0 24 24, stroke currentColor, fill none, weight 1.9, round caps/joins.
// KIND/REALM icons live in explorer/data.ts — NOT here.

// Inner SVG markup per icon (paths/shapes only). viewBox is always 0 0 24 24.
const ICONS = {
  // nav: trailing CTA arrow + landing hero "Get started" arrow (Rifty.dc.html L99).
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6" />',
  // nav npm copy chip (Rifty.dc.html L77): clipboard / copy.
  copy: '<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />',
  // copy-chip success state.
  check: '<path d="M20 6 9 17l-5-5" />',
  // quickstart warning callout (Rifty.dc.html L183): COI required.
  'warning-triangle':
    '<path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />',
  // mono terminal prompt glyph (Rifty.dc.html L166: boot.ts tab marker).
  'terminal-dot': '<path d="M4 17l6-6-6-6M12 19h8" />',
  // "What you get" feature tiles (Rifty.dc.html buildFeatures, single-path glyphs):
  // Node-compatible runtime — terminal prompt.
  'feature-runtime': '<path d="M4 17l6-6-6-6M12 19h8" />',
  // npm install, in-browser — package box.
  'feature-npm':
    '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />',
  // WASI preview1 runner — stacked layers.
  'feature-wasi': '<path d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />',
  // Virtual FS + OPFS — folder.
  'feature-vfs':
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />',
} as const;

// `github` renders as a solid fill mark (not a 1.9 line icon) but is still a valid IconName.
export type IconName = keyof typeof ICONS | 'github';

// GitHub mark is a solid-fill mark (16x16 path), kept as its own renderer (Rifty.dc.html L80).
const GITHUB_MARK =
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />';

/**
 * Inline `<svg>` string for a line icon (or the GitHub fill mark).
 * @param name icon id
 * @param size width/height in px (default 16)
 */
export function icon(name: IconName, size = 16): string {
  if (name === 'github') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${GITHUB_MARK}</svg>`;
  }
  const body = ICONS[name];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// The "diamond" logo mark (Rifty.dc.html mark set L239): a rounded square rotated 45°.
// fill currentColor so callers theme it via color (accent lime on the landing).
export const logoMark: string =
  '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="3" transform="rotate(45 12 12)" /></svg>';
