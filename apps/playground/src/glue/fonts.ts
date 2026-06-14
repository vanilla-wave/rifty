// Mono stack for code surfaces (Monaco editor, xterm terminal, seeded previews).
// Single source of truth so sandbox code typography never drifts; mirrors
// --rf-font-mono in styles/theme.css. JetBrains Mono is self-hosted under
// /fonts (woff2 subsets).
export const MONO_FONT_STACK = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
