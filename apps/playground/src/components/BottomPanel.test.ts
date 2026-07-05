import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Diagnostic, DiagnosticSeverity } from '@riftydev/ts-language-service/lsp-types';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { BottomPanel } from './BottomPanel.tsx';
import { ProblemsPanel, flattenProblems } from './ProblemsPanel.tsx';

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

function render(
  activeSessionId = 'terminal-2',
  diagnostics?: ReadonlyMap<string, readonly Diagnostic[]>,
): string {
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
      diagnostics,
    }),
  );
}

function diag(message: string, line = 0, character = 0): Diagnostic {
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    severity: DiagnosticSeverity.Error,
    message,
    code: 2322,
    source: 'ts',
  };
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

  it('pins Problems to the left before terminal tabs and the new-terminal action', () => {
    const html = render();
    const tabsbar = html.indexOf('class="rf-terminal-tabsbar"');
    const problems = html.indexOf('data-testid="problems-tab"', tabsbar);
    const tablist = html.indexOf('role="tablist"', tabsbar);
    const newTerminal = html.indexOf('aria-label="New terminal"', tabsbar);

    expect(tabsbar).toBeGreaterThanOrEqual(0);
    expect(problems).toBeGreaterThan(tabsbar);
    expect(tablist).toBeGreaterThan(problems);
    expect(newTerminal).toBeGreaterThan(tablist);
  });

  it('keeps only the active mounted terminal discoverable by test id', () => {
    const html = render();

    expect(html.match(/data-testid="terminal"/g)).toHaveLength(1);
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-active="false"');
  });

  it('keys terminal panel instances by stable session id, not snapshot object identity', () => {
    // Behavioral half: every session renders its own keyed slot.
    const html = render();
    expect(html).toContain('class="rf-terminal-slot" data-session-id="terminal-1"');
    expect(html).toContain('class="rf-terminal-slot" data-session-id="terminal-2"');
    // residual source pin: keyed reconciliation is client-only — node vitest
    // runs the solid SERVER runtime, renderToString renders once, so "a fresh
    // sessions snapshot with unchanged ids must NOT recreate terminal slots"
    // is unobservable here. Both <For>s (tab strip + terminal slots) must
    // iterate the sessionIds() string memo, never props.sessions — fresh
    // snapshot objects every poll would remount TerminalPanels and lose xterm
    // scrollback + the live attach.
    expect(bottomPanelSource.match(/<For each=\{sessionIds\(\)\}>/g)).toHaveLength(2);
  });

  it('renders Problems as a permanent terminal-session tab (ADR-0166 P1.9c)', () => {
    const html = render();
    expect(html).toContain('data-testid="problems-tab"');
    expect(html).toContain('Problems');
    expect(html).toContain('aria-label="Console tabs"');
    expect(html).not.toContain('aria-label="Close Problems"');
    expect(html).not.toContain('aria-label="Bottom panel views"');
  });

  it('shows the problem count badge when diagnostics are present, hides it otherwise', () => {
    const empty = render('terminal-2', new Map());
    expect(empty).not.toContain('data-testid="problems-count"');

    const withDiags = render(
      'terminal-2',
      new Map([['/workspace/src/x.ts', [diag('a'), diag('b')]]]),
    );
    expect(withDiags).toContain('data-testid="problems-count"');
    expect(withDiags).toContain('>2<'); // two diagnostics aggregated into the badge
  });
});

describe('ProblemsPanel', () => {
  function renderPanel(diagnostics: ReadonlyMap<string, readonly Diagnostic[]>): string {
    return renderToString(() => ProblemsPanel({ diagnostics, onOpen: () => {} }));
  }

  it('renders an empty state when there are no diagnostics', () => {
    const html = renderPanel(new Map());
    expect(html).toContain('data-testid="problems-empty"');
    expect(html).not.toContain('data-testid="problem-row"');
  });

  it('renders a clickable diagnostic row with message + 1-based location', () => {
    const html = renderPanel(
      // LSP 0-based line 4, char 2 → displayed/jumped as 5:3.
      new Map([['/workspace/src/main.ts', [diag('Type mismatch', 4, 2)]]]),
    );
    expect(html).toContain('data-testid="problem-row"');
    expect(html).toContain('Type mismatch');
    expect(html).toContain('main.ts:5:3');
    // Severity carried through as the data attribute (Error === 1).
    expect(html).toContain(`data-severity="${DiagnosticSeverity.Error}"`);
  });

  it('flattens + sorts diagnostics by path then position', () => {
    const rows = flattenProblems(
      new Map([
        ['/b.ts', [diag('b1', 2, 0)]],
        ['/a.ts', [diag('a2', 5, 1), diag('a1', 1, 0)]],
      ]),
    );
    expect(rows.map((r) => r.diagnostic.message)).toEqual(['a1', 'a2', 'b1']);
  });
});
