import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { BottomPanel } from './BottomPanel.tsx';

vi.mock('@riftydev/terminal', () => ({
  RiftyTerminal: class {
    cols = 80;
    rows = 24;
    mount() {}
    write() {}
    dispose() {}
  },
  applyAutocompleteItem: () => ({ line: '', cursor: 0 }),
  commandBlockAtViewport: () => null,
  commandBlockRailItems: () => [],
  createAutocompleteState: (items: unknown) => ({ items, index: 0, start: 0, end: 0 }),
  makeTerminalHtmlExport: (content: string) => ({
    content,
    filename: 'terminal.html',
    mimeType: 'text/html',
  }),
  moveAutocompleteIndex: (state: unknown) => state,
  searchTerminalHistory: () => [],
}));

const sessions = [
  { id: 'terminal-1', title: 'Terminal 1', cwd: '/workspace', env: {}, status: 'idle' as const },
  { id: 'terminal-2', title: 'Server', cwd: '/workspace', env: {}, status: 'running' as const },
];

function render(activeSessionId = 'terminal-2'): string {
  return renderToString(() =>
    BottomPanel({
      collapsed: false,
      sessions,
      activeSessionId,
      onToggleCollapse: () => {},
      onSelectSession: () => {},
      onCreateSession: () => {},
      onCloseSession: () => {},
      attach: () => {},
      onLine: () => 0,
    }),
  );
}

const bottomPanelSource = readFileSync(
  fileURLToPath(new URL('./BottomPanel.tsx', import.meta.url)),
  'utf8',
);

describe('BottomPanel', () => {
  it('renders the Terminal label, session tabs, and terminal controls', () => {
    const html = render();

    expect(html).toContain('Terminal');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="New terminal"');
    // No Stop button by design (2026-06-11): server state shows in the status
    // pills; stopping goes through Ctrl-C / the ⌘K palette.
    expect(html).not.toContain('rf-terminal-stop');
    expect(html).toContain('aria-label="Close Terminal 1"');
    expect(html).not.toContain('aria-label="Close Server"');
  });

  it('keeps the new-terminal button attached to the terminal tab strip', () => {
    const html = render();
    const tabsbar = html.indexOf('class="rf-terminal-tabsbar"');
    const tablist = html.indexOf('role="tablist"', tabsbar);
    const newTerminal = html.indexOf('aria-label="New terminal"', tabsbar);

    expect(tabsbar).toBeGreaterThanOrEqual(0);
    expect(tablist).toBeGreaterThan(tabsbar);
    expect(newTerminal).toBeGreaterThan(tablist);
  });

  it('keeps only the active mounted terminal discoverable by test id', () => {
    const html = render();

    expect(html.match(/data-testid="terminal"/g)).toHaveLength(1);
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-active="false"');
  });

  it('keys terminal panel instances by stable session id, not snapshot object identity', () => {
    expect(bottomPanelSource).toContain('sessionIds');
    expect(bottomPanelSource).toContain('<For each={sessionIds()}>');
  });
});
