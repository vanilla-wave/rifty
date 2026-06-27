import type {
  TerminalCompleter,
  TerminalGhostSuggestionProvider,
  TerminalHistoryRecord,
  TerminalInputResult,
  TerminalInputValidator,
  TerminalLineHighlighter,
  TerminalRawInput,
  TerminalRewriteRule,
} from '@riftydev/terminal';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { TerminalSessionSnapshot } from '../adapters/terminal-manager.ts';
import { ProblemsPanel } from './ProblemsPanel.tsx';
import { type TerminalDims, type TerminalModeHint, TerminalPanel } from './TerminalPanel.tsx';

export function BottomPanel(props: {
  collapsed: boolean;
  sessions: readonly TerminalSessionSnapshot[];
  activeSessionId: string;
  terminalFocusEpoch?: number;
  modeHint?: TerminalModeHint;
  onToggleCollapse(): void;
  onSelectSession(id: string): void;
  onCreateSession(): void;
  onCloseSession(id: string): void;
  attach(id: string, write: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  onLine(
    id: string,
    line: string,
    dims: TerminalDims,
  ): TerminalInputResult | Promise<TerminalInputResult>;
  completer?: TerminalCompleter;
  commandItems?: () => readonly string[];
  highlighter?: TerminalLineHighlighter;
  ghostSuggestion?: TerminalGhostSuggestionProvider;
  inputValidator?: TerminalInputValidator;
  rewriteRules?: () => readonly TerminalRewriteRule[];
  historyRecords?: () => readonly TerminalHistoryRecord[];
  onSignal?(id: string): void;
  onRawInput?(id: string, data: TerminalRawInput): void;
  onLink?(uri: string, event: MouseEvent): void;
  /** Aggregated TS diagnostics for the Problems tab (ADR-0166 P1.9c), path→diags. */
  diagnostics?: ReadonlyMap<string, readonly Diagnostic[]>;
  /** Problems click-to-jump: `line`/`column` are 1-based Monaco coordinates. */
  onOpenProblem?(path: string, line: number, column: number): void;
}) {
  const sessionIds = createMemo(() => props.sessions.map((session) => session.id));
  const sessionById = (id: string) => props.sessions.find((session) => session.id === id);

  // Bottom-panel tab strip (ADR-0166 P1.9c): terminal sessions plus the permanent
  // Problems tab. Terminal stays the default. The problem COUNT lives in the tab.
  const [view, setView] = createSignal<'terminal' | 'problems'>('terminal');
  const problemCount = createMemo(() => {
    let n = 0;
    for (const diags of props.diagnostics?.values() ?? []) n += diags.length;
    return n;
  });

  createEffect(() => {
    if ((props.terminalFocusEpoch ?? 0) > 0) setView('terminal');
  });

  return (
    <section
      class="rf-console rf-card"
      data-collapsed={props.collapsed}
      data-testid="terminal-panel"
    >
      <div class="rf-console__head">
        <button
          type="button"
          class="rf-console__toggle"
          aria-expanded={!props.collapsed}
          aria-label={props.collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={() => props.onToggleCollapse()}
        >
          <span class="rf-console__chevron" data-collapsed={props.collapsed} aria-hidden="true">
            ⌄
          </span>
        </button>

        <div class="rf-terminal-tabsbar">
          <div
            class="rf-terminal-tab rf-terminal-tab--problems"
            data-active={view() === 'problems'}
            data-running={false}
          >
            <button
              type="button"
              role="tab"
              class="rf-terminal-tab__select"
              data-testid="problems-tab"
              aria-selected={view() === 'problems'}
              onClick={() => setView('problems')}
            >
              <span class="rf-terminal-tab__label">Problems</span>
              <Show when={problemCount() > 0}>
                <span class="rf-console__badge" data-testid="problems-count">
                  {problemCount()}
                </span>
              </Show>
            </button>
          </div>
          <div class="rf-terminal-tabs" role="tablist" aria-label="Console tabs">
            <For each={sessionIds()}>
              {(id) => {
                const session = () => sessionById(id);
                const isActive = () => view() === 'terminal' && id === props.activeSessionId;
                const isRunning = () => session()?.status === 'running';
                return (
                  <Show when={session()}>
                    {(current) => (
                      <div
                        class="rf-terminal-tab"
                        data-active={isActive()}
                        data-running={isRunning()}
                      >
                        <button
                          type="button"
                          role="tab"
                          class="rf-terminal-tab__select"
                          aria-selected={isActive()}
                          onClick={() => {
                            setView('terminal');
                            props.onSelectSession(id);
                          }}
                        >
                          <span class="rf-terminal-tab__dot" aria-hidden="true" />
                          <span class="rf-terminal-tab__label">{current().title}</span>
                        </button>
                        <Show when={!isRunning()}>
                          <button
                            type="button"
                            class="rf-terminal-tab__close"
                            aria-label={`Close ${current().title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onCloseSession(id);
                            }}
                          >
                            ×
                          </button>
                        </Show>
                      </div>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
          <button
            type="button"
            class="rf-terminal-action"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => {
              setView('terminal');
              props.onCreateSession();
            }}
          >
            +
          </button>
        </div>
      </div>
      <div class="rf-console__body">
        {/* Terminal stays MOUNTED across a view switch (preserves xterm scrollback +
            the live attach); only its visibility toggles. The Problems body is
            mounted only when its tab is active. */}
        <div class="rf-console__pane" data-view="terminal" data-active={view() === 'terminal'}>
          <For each={sessionIds()}>
            {(id) => (
              <div class="rf-terminal-slot" data-active={id === props.activeSessionId}>
                <TerminalPanel
                  testId={id === props.activeSessionId ? 'terminal' : undefined}
                  attach={(write) => props.attach(id, write)}
                  onSignal={() => props.onSignal?.(id)}
                  onRawInput={(data) => props.onRawInput?.(id, data)}
                  onLink={props.onLink}
                  focusEpoch={id === props.activeSessionId ? props.terminalFocusEpoch : 0}
                  onLine={(line, dims) => props.onLine(id, line, dims)}
                  modeHint={props.modeHint}
                  completer={props.completer}
                  commandItems={props.commandItems}
                  highlighter={props.highlighter}
                  ghostSuggestion={props.ghostSuggestion}
                  inputValidator={props.inputValidator}
                  rewriteRules={props.rewriteRules}
                  historyRecords={props.historyRecords}
                />
              </div>
            )}
          </For>
        </div>
        <Show when={view() === 'problems'}>
          <div class="rf-console__pane" data-view="problems" data-active={true}>
            <ProblemsPanel
              diagnostics={props.diagnostics ?? new Map()}
              onOpen={(path, line, column) => props.onOpenProblem?.(path, line, column)}
            />
          </div>
        </Show>
      </div>
    </section>
  );
}
