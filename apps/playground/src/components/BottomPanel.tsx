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
import { For, Show, createMemo } from 'solid-js';
import type { TerminalSessionSnapshot } from '../adapters/terminal-manager.ts';
import { type TerminalDims, type TerminalModeHint, TerminalPanel } from './TerminalPanel.tsx';

export function BottomPanel(props: {
  collapsed: boolean;
  sessions: readonly TerminalSessionSnapshot[];
  activeSessionId: string;
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
}) {
  const sessionIds = createMemo(() => props.sessions.map((session) => session.id));
  const sessionById = (id: string) => props.sessions.find((session) => session.id === id);

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
          aria-label={props.collapsed ? 'Expand terminal' : 'Collapse terminal'}
          onClick={() => props.onToggleCollapse()}
        >
          <span class="rf-console__chevron" data-collapsed={props.collapsed} aria-hidden="true">
            ⌄
          </span>
          <span class="rf-eyebrow">Terminal</span>
        </button>

        <div class="rf-terminal-tabsbar">
          <div class="rf-terminal-tabs" role="tablist" aria-label="Terminal sessions">
            <For each={sessionIds()}>
              {(id) => {
                const session = () => sessionById(id);
                const isActive = () => id === props.activeSessionId;
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
                          onClick={() => props.onSelectSession(id)}
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
            onClick={() => props.onCreateSession()}
          >
            +
          </button>
        </div>
      </div>
      <div class="rf-console__body">
        <For each={sessionIds()}>
          {(id) => (
            <div class="rf-terminal-slot" data-active={id === props.activeSessionId}>
              <TerminalPanel
                testId={id === props.activeSessionId ? 'terminal' : undefined}
                attach={(write) => props.attach(id, write)}
                onSignal={() => props.onSignal?.(id)}
                onRawInput={(data) => props.onRawInput?.(id, data)}
                onLink={props.onLink}
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
    </section>
  );
}
