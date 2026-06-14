// Mono stack for code surfaces (Monaco editor + xterm terminal). Single source
// of truth so editor and terminal never drift; mirrors --rf-font-mono in
// styles/theme.css. JetBrains Mono is self-hosted under /fonts (woff2 subsets).
export const MONO_FONT_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
