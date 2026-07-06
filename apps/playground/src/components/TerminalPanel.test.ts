import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from './TerminalPanel.tsx';
import { TERMINAL_APPEARANCE } from './terminal-appearance.ts';

// @riftydev/terminal transitively pulls @xterm/* whose bundles reference
// `self` — unloadable under a plain node environment. RiftyTerminal is only
// constructed in onMount (never during SSR), so a shape-stub is enough.
vi.mock('@riftydev/terminal', () => ({
  RiftyTerminal: class {
    cols = 80;
    rows = 24;
    mount() {}
    write() {}
    dispose() {}
  },
  applyAutocompleteItem: () => ({ line: '', cursor: 0 }),
  createAutocompleteState: (items: unknown) => ({ items, index: 0, start: 0, end: 0 }),
  makeTerminalHtmlExport: (content: string) => ({
    content,
    filename: 'terminal.html',
    mimeType: 'text/html',
  }),
  moveAutocompleteIndex: (state: unknown) => state,
  searchTerminalHistory: () => [],
}));

function render(): string {
  return renderToString(() =>
    TerminalPanel({
      attach: () => {},
      onLine: () => 0,
      testId: 'terminal',
    }),
  );
}

describe('TerminalPanel', () => {
  it('mounts the xterm host and hidden buffer mirror — no command-block rail, preview, or sticky overlays', () => {
    const html = render();

    expect(html).toContain('rf-terminal-shell');
    expect(html).toContain('data-testid="terminal"');
    expect(html).toContain('data-testid="terminal-buffer"');
    // Command-block overlays were removed by design; they must not come back.
    expect(html).not.toContain('rf-terminal-blockrail');
    expect(html).not.toContain('rf-terminal-blockpreview');
    expect(html).not.toContain('rf-terminal-sticky');
  });

  it('uses a modern bar caret and denser terminal typography', () => {
    expect(TERMINAL_APPEARANCE.cursorStyle).toBe('bar');
    expect(TERMINAL_APPEARANCE.fontSize).toBe(13);
    // 13px glyphs on 18px rows.
    expect(TERMINAL_APPEARANCE.fontSize * TERMINAL_APPEARANCE.lineHeight).toBeCloseTo(18, 10);
  });

  it('feeds the appearance config into the xterm constructor options', () => {
    const terminalPanelSource = readFileSync(
      fileURLToPath(new URL('./TerminalPanel.tsx', import.meta.url)),
      'utf8',
    );
    // residual source pin: RiftyTerminal is constructed inside onMount —
    // client-only; node vitest runs the solid SERVER runtime, so the xterm
    // ctor options are behaviorally unobservable here. The values themselves
    // are pinned via TERMINAL_APPEARANCE above; this pins the spread wiring.
    expect(terminalPanelSource).toContain('...TERMINAL_APPEARANCE');
  });
});

const themeSource = readFileSync(
  fileURLToPath(new URL('../styles/theme.css', import.meta.url)),
  'utf8',
);

describe('TerminalPanel surface (theme.css)', () => {
  it('does not reserve left gutter space for removed command-block rails', () => {
    expect(themeSource).toContain('inset: 8px 4px 8px 14px;');
    expect(themeSource).not.toContain('.rf-terminal-blockrail');
    expect(themeSource).not.toContain('.rf-terminal-blockpreview');
    expect(themeSource).not.toContain('.rf-terminal-sticky');
  });

  it('paints a distinct modern terminal surface around xterm', () => {
    expect(themeSource).toContain('background: #171a21;');
    expect(themeSource).toContain('border-radius: var(--rf-r-sm);');
    expect(themeSource).toContain('box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.045)');
  });
});
