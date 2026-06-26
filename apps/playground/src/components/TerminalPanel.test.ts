import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const terminalPanelSource = readFileSync(
  fileURLToPath(new URL('./TerminalPanel.tsx', import.meta.url)),
  'utf8',
);

const themeSource = readFileSync(
  fileURLToPath(new URL('../styles/theme.css', import.meta.url)),
  'utf8',
);

describe('TerminalPanel command overlays', () => {
  it('does not mount command-block rail, preview, or sticky command overlays', () => {
    expect(terminalPanelSource).not.toContain('rf-terminal-blockrail');
    expect(terminalPanelSource).not.toContain('rf-terminal-blockpreview');
    expect(terminalPanelSource).not.toContain('rf-terminal-sticky');
  });

  it('does not reserve left gutter space for removed command-block rails', () => {
    expect(themeSource).toContain('inset: 8px 4px 8px 14px;');
    expect(themeSource).not.toContain('.rf-terminal-blockrail');
    expect(themeSource).not.toContain('.rf-terminal-blockpreview');
    expect(themeSource).not.toContain('.rf-terminal-sticky');
  });

  it('uses a modern bar caret and denser terminal typography', () => {
    expect(terminalPanelSource).toContain("cursorStyle: 'bar'");
    expect(terminalPanelSource).toContain('fontSize: 13');
    expect(terminalPanelSource).toContain('lineHeight: 18 / 13');
  });

  it('paints a distinct modern terminal surface around xterm', () => {
    expect(themeSource).toContain('background: #171a21;');
    expect(themeSource).toContain('border-radius: var(--rf-r-sm);');
    expect(themeSource).toContain('box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.045)');
  });
});
