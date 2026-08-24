import {
  RiftyTerminal,
  type TerminalAutocompleteState,
  type TerminalBusyInputEvent,
  type TerminalCompleter,
  type TerminalEditState,
  type TerminalGhostSuggestionProvider,
  type TerminalHistoryRecord,
  type TerminalInputResult,
  type TerminalInputValidator,
  type TerminalLineHighlighter,
  type TerminalRawInput,
  type TerminalRewriteRule,
  applyAutocompleteItem,
  createAutocompleteState,
  makeTerminalHtmlExport,
  moveAutocompleteIndex,
  searchTerminalHistory,
} from '@riftydev/terminal';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { MONO_FONT_STACK } from '../glue/fonts.ts';
import { type TerminalQuickFix, detectTerminalQuickFix } from '../glue/terminal-quick-fix.ts';
import { preferredTerminalTheme, watchPreferredTerminalTheme } from '../glue/terminal-theme.ts';
import { terminalWelcomeBanner } from '../glue/terminal-welcome-banner.ts';
import { Icon } from './icons.tsx';
import { TERMINAL_APPEARANCE } from './terminal-appearance.ts';
import { createBufferRefreshScheduler } from './terminal-buffer-scheduler.ts';
import { terminalMirrorText } from './terminal-mirror-text.ts';

/** Live terminal dimensions handed to `onLine` so the shell sees `ctx.cols/rows`. */
export interface TerminalDims {
  readonly cols: number;
  readonly rows: number;
}

interface PaletteItem {
  readonly label: string;
  readonly command?: string;
  readonly action?: () => void;
}

export interface TerminalModeHintAction {
  readonly label: string;
  readonly title: string;
  readonly line?: string;
  readonly onSelect?: () => void;
}

export interface TerminalModeHint {
  readonly label: string;
  readonly detail: string;
  readonly actions?: readonly TerminalModeHintAction[];
}

export function TerminalPanel(props: {
  attach(write: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  onLine(line: string, dims: TerminalDims): TerminalInputResult | Promise<TerminalInputResult>;
  modeHint?: TerminalModeHint;
  active?: boolean;
  completer?: TerminalCompleter;
  onCompletionError?(error: unknown): void;
  commandItems?: () => readonly string[];
  highlighter?: TerminalLineHighlighter;
  ghostSuggestion?: TerminalGhostSuggestionProvider;
  inputValidator?: TerminalInputValidator;
  rewriteRules?: () => readonly TerminalRewriteRule[];
  historyRecords?: () => readonly TerminalHistoryRecord[];
  /** Ctrl+C from the terminal — wire to the shell session's `interrupt()`. */
  onSignal?(): void;
  onRawInput?(data: TerminalRawInput): void;
  onResize?(dims: TerminalDims): void;
  onLink?(uri: string, event: MouseEvent): void;
  focusEpoch?: number;
  testId?: string;
}) {
  let container: HTMLDivElement | undefined;
  let findInput: HTMLInputElement | undefined;
  let paletteInput: HTMLInputElement | undefined;
  let historyInput: HTMLInputElement | undefined;
  let term: RiftyTerminal | undefined;
  let disposeTheme: (() => void) | undefined;
  const [findOpen, setFindOpen] = createSignal(false);
  const [findQuery, setFindQuery] = createSignal('');
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteQuery, setPaletteQuery] = createSignal('');
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyQuery, setHistoryQuery] = createSignal('');
  const [historyIndex, setHistoryIndex] = createSignal(0);
  const [quickFix, setQuickFix] = createSignal<TerminalQuickFix | null>(null);
  const [editState, setEditState] = createSignal<TerminalEditState>({ line: '', cursor: 0 });
  const [autocomplete, setAutocomplete] = createSignal<TerminalAutocompleteState | null>(null);
  const [terminalBuffer, setTerminalBuffer] = createSignal('');
  const [busyNotice, setBusyNotice] = createSignal(false);
  let stderrTail = '';
  let lastSubmittedLine = '';
  let completionSeq = 0;
  let busyNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  const isActive = () => props.active !== false;
  const paletteItems = createMemo<readonly PaletteItem[]>(() => {
    const query = paletteQuery().trim().toLowerCase();
    const actions: PaletteItem[] = [
      { label: 'Copy output', action: () => copyTerminalText() },
      { label: 'Copy output as HTML', action: () => copyTerminalHtml() },
      { label: 'Download output HTML', action: () => downloadTerminalHtml() },
    ];
    const commands = (props.commandItems?.() ?? []).map((command) => ({
      label: command,
      command,
    }));
    const items = [...actions, ...commands];
    if (query.length === 0) return items.slice(0, 8);
    return items.filter((item) => item.label.toLowerCase().includes(query)).slice(0, 8);
  });
  const historyItems = createMemo(() =>
    searchTerminalHistory(props.historyRecords?.() ?? [], historyQuery(), 12),
  );

  function copyTerminalText(): void {
    try {
      const text = term?.serializeText({ excludeModes: true }) ?? '';
      void globalThis.navigator?.clipboard?.writeText(text)?.catch(() => {});
    } catch {
      /* best effort */
    }
  }

  function copyTerminalHtml(): void {
    try {
      const html = term?.serializeHtml({ includeGlobalBackground: true }) ?? '';
      const text = term?.serializeText({ excludeModes: true }) ?? '';
      const clipboard = globalThis.navigator?.clipboard;
      if (typeof ClipboardItem !== 'undefined' && clipboard?.write) {
        void clipboard
          .write([
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
          ])
          .catch(() => clipboard.writeText(text));
        return;
      }
      void clipboard?.writeText(text)?.catch(() => {});
    } catch {
      /* best effort */
    }
  }

  function downloadTerminalHtml(): void {
    try {
      const html = term?.serializeHtml({ includeGlobalBackground: true }) ?? '';
      const artifact = makeTerminalHtmlExport(html);
      const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = artifact.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      /* best effort */
    }
  }

  function refreshTerminalBuffer(): void {
    const t = term;
    if (!t) {
      setTerminalBuffer('');
      return;
    }
    // xterm parses writes on a deferred macrotask; serialize only once they have
    // landed, else a final dev-server-ready line (no trailing output to trigger a
    // later refresh) is missed — the CI-only `data-terminal-buffer` marker flake.
    void t
      .snapshotBufferSettled({ excludeModes: true })
      .then((text) => setTerminalBuffer(terminalMirrorText(text)))
      .catch(() => setTerminalBuffer(''));
  }

  // Coalesce the mirror refresh, but cap the wait so a reset-on-every-write
  // debounce can't starve `data-terminal-buffer` under a streaming dev server.
  // See terminal-buffer-scheduler. (Marker-flush correctness is handled by
  // `snapshotBufferSettled` above, not the debounce.)
  const bufferRefresh = createBufferRefreshScheduler(() => refreshTerminalBuffer());
  function scheduleTerminalBufferRefresh(): void {
    bufferRefresh.schedule();
  }

  function showBusyNotice(_event: TerminalBusyInputEvent): void {
    setBusyNotice(true);
    if (busyNoticeTimer) clearTimeout(busyNoticeTimer);
    busyNoticeTimer = setTimeout(() => setBusyNotice(false), 1800);
    scheduleTerminalBufferRefresh();
  }

  const focusFind = () => {
    requestAnimationFrame(() => findInput?.focus());
  };

  const openFind = () => {
    setAutocomplete(null);
    setHistoryOpen(false);
    setPaletteOpen(false);
    setFindOpen(true);
    focusFind();
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery('');
    term?.clearSearch();
    term?.focus();
  };

  const openPalette = () => {
    setAutocomplete(null);
    setHistoryOpen(false);
    setFindOpen(false);
    setPaletteOpen(true);
    setPaletteQuery('');
    setPaletteIndex(0);
    requestAnimationFrame(() => paletteInput?.focus());
  };

  const closePalette = (focusTerminal = true) => {
    setPaletteOpen(false);
    setPaletteQuery('');
    setPaletteIndex(0);
    if (focusTerminal) term?.focus();
  };

  const menuCompleter: TerminalCompleter = async (line, cursor) => {
    if (!props.completer || !isActive()) return null;
    const seq = ++completionSeq;
    try {
      const result = await props.completer(line, cursor);
      const current = editState();
      if (
        !isActive() ||
        seq !== completionSeq ||
        current.line !== line ||
        current.cursor !== cursor
      ) {
        return null;
      }
      setAutocomplete(createAutocompleteState(result));
    } catch (error: unknown) {
      if (!isActive() || seq !== completionSeq) return null;
      setAutocomplete(null);
      props.onCompletionError?.(error);
    }
    return null;
  };

  const invalidateAutocomplete = () => {
    completionSeq++;
    setAutocomplete(null);
  };

  const closeAutocomplete = () => {
    invalidateAutocomplete();
    term?.focus();
  };

  const chooseAutocompleteItem = (state: TerminalAutocompleteState | null) => {
    if (!state || !term) return;
    const item = state.items[state.index];
    const next = applyAutocompleteItem(editState().line, state, item);
    setAutocomplete(null);
    completionSeq++;
    term.replaceLine(next.line, next.cursor);
  };

  const openHistory = () => {
    if ((props.historyRecords?.() ?? []).length === 0) return;
    setAutocomplete(null);
    setFindOpen(false);
    setPaletteOpen(false);
    setHistoryQuery(editState().line);
    setHistoryIndex(0);
    setHistoryOpen(true);
    requestAnimationFrame(() => historyInput?.focus());
  };

  const closeHistory = (focusTerminal = true) => {
    setHistoryOpen(false);
    setHistoryQuery('');
    setHistoryIndex(0);
    if (focusTerminal) term?.focus();
  };

  const chooseHistoryItem = (item: TerminalHistoryRecord | undefined) => {
    if (!item) return;
    term?.replaceLine(item.command);
    closeHistory(false);
  };

  const focusTerminalSoon = () => {
    requestAnimationFrame(() => term?.focus());
  };

  const choosePaletteItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.action) item.action();
    if (item.command) term?.replaceLine(item.command);
    closePalette(false);
  };

  const chooseModeHintAction = (action: TerminalModeHintAction) => {
    setAutocomplete(null);
    setHistoryOpen(false);
    setPaletteOpen(false);
    setFindOpen(false);
    if (action.line) {
      void term?.submitLine(action.line);
      scheduleTerminalBufferRefresh();
      return;
    }
    action.onSelect?.();
    term?.focus();
  };

  const inspectQuickFix = (chunk: string, stream?: 'stdout' | 'stderr') => {
    if (stream !== 'stderr') return;
    stderrTail = `${stderrTail}${chunk}`.slice(-600);
    const fix = detectTerminalQuickFix({ stderr: stderrTail, lastCommand: lastSubmittedLine });
    if (fix) setQuickFix(fix);
  };

  const search = (direction: 'next' | 'previous', incremental = false) => {
    const query = findQuery();
    if (query.length === 0) {
      term?.clearSearch();
      return;
    }
    if (direction === 'next') term?.findNext(query, { incremental });
    else term?.findPrevious(query);
  };

  const terminalOwnsFocus = () => {
    const active = document.activeElement;
    return active != null && container?.parentElement?.contains(active);
  };

  onMount(() => {
    if (!container) return;
    term = new RiftyTerminal({
      banner: terminalWelcomeBanner,
      onInput: (line) => {
        lastSubmittedLine = line;
        stderrTail = '';
        setQuickFix(null);
        setAutocomplete(null);
        setHistoryOpen(false);
        return props.onLine(line, { cols: term?.cols ?? 80, rows: term?.rows ?? 24 });
      },
      completer: props.completer ? menuCompleter : undefined,
      highlighter: props.highlighter,
      ghostSuggestion: props.ghostSuggestion,
      inputValidator: props.inputValidator,
      onRawInput: props.onRawInput,
      get rewriteRules() {
        return props.rewriteRules?.() ?? [];
      },
      onEditStateChange: (state) => {
        completionSeq++;
        setEditState(state);
        if (autocomplete()) setAutocomplete(null);
        scheduleTerminalBufferRefresh();
      },
      onBusyInput: showBusyNotice,
      theme: preferredTerminalTheme(),
      fontFamily: MONO_FONT_STACK,
      ...TERMINAL_APPEARANCE,
      webLinks: props.onLink ? { onLink: props.onLink } : undefined,
      webgl: navigator.webdriver ? false : undefined,
      onSignal: props.onSignal ? () => props.onSignal?.() : undefined,
      onResize: (cols, rows) => props.onResize?.({ cols, rows }),
    });
    disposeTheme = watchPreferredTerminalTheme(globalThis, (theme) => term?.setTheme(theme));
    term.mount(container);
    if ((props.focusEpoch ?? 0) > 0) focusTerminalSoon();
    scheduleTerminalBufferRefresh();
    props.attach((chunk, stream) => {
      term?.write(chunk, stream);
      inspectQuickFix(chunk, stream);
      scheduleTerminalBufferRefresh();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (findOpen() || paletteOpen() || historyOpen()) return;
      const menu = isActive() && terminalOwnsFocus() ? autocomplete() : null;
      if (menu) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          setAutocomplete(moveAutocompleteIndex(menu, 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          setAutocomplete(moveAutocompleteIndex(menu, -1));
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeAutocomplete();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          chooseAutocompleteItem(menu);
          return;
        }
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'r') {
        if (!terminalOwnsFocus() || (props.historyRecords?.() ?? []).length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        openHistory();
        return;
      }
      if (key === 'f') {
        if (!findOpen() && !terminalOwnsFocus()) return;
        event.preventDefault();
        event.stopPropagation();
        openFind();
      }
      if (key === 'p' && event.shiftKey) {
        if (!paletteOpen() && !terminalOwnsFocus()) return;
        event.preventDefault();
        event.stopPropagation();
        openPalette();
      }
    };
    const terminalShell = container.parentElement;
    const onFocusOut = () => {
      queueMicrotask(() => {
        if (!terminalOwnsFocus()) invalidateAutocomplete();
      });
    };
    terminalShell?.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => {
      terminalShell?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    });
  });

  createEffect(() => {
    if (!isActive()) invalidateAutocomplete();
  });

  createEffect(() => {
    const epoch = props.focusEpoch ?? 0;
    if (epoch <= 0 || !term) return;
    focusTerminalSoon();
  });

  onCleanup(() => {
    if (busyNoticeTimer) clearTimeout(busyNoticeTimer);
    bufferRefresh.cancel();
    disposeTheme?.();
    term?.dispose();
  });

  return (
    <div class="rf-terminal-shell">
      <div ref={container} class="rf-terminal" data-testid={props.testId} />
      <output
        class="rf-terminal-buffer"
        data-testid="terminal-buffer"
        data-terminal-buffer={terminalBuffer()}
        aria-hidden="true"
        hidden
      />
      <Show when={props.modeHint}>
        {(hint) => (
          <div class="rf-terminal-modehint" data-testid="terminal-mode-hint">
            <span class="rf-terminal-modehint__label">{hint().label}</span>
            <span class="rf-terminal-modehint__detail">{hint().detail}</span>
            <Show when={hint().actions?.length}>
              <span class="rf-terminal-modehint__actions">
                <For each={hint().actions ?? []}>
                  {(action) => (
                    <button
                      type="button"
                      class="rf-terminal-modehint__action"
                      aria-label={action.title}
                      title={action.title}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseModeHintAction(action)}
                    >
                      {action.label}
                    </button>
                  )}
                </For>
              </span>
            </Show>
          </div>
        )}
      </Show>
      <Show when={findOpen()}>
        <div class="rf-terminal-find">
          <Icon name="search" size={14} />
          <input
            ref={findInput}
            class="rf-terminal-find__input"
            value={findQuery()}
            placeholder="Find"
            onInput={(event) => {
              setFindQuery(event.currentTarget.value);
              search('next', true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeFind();
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                search(event.shiftKey ? 'previous' : 'next');
              }
            }}
          />
          <button
            class="rf-terminal-find__button"
            type="button"
            aria-label="Previous match"
            onClick={() => search('previous')}
          >
            <Icon name="chevron-up" size={14} />
          </button>
          <button
            class="rf-terminal-find__button"
            type="button"
            aria-label="Next match"
            onClick={() => search('next')}
          >
            <Icon name="chevron-down" size={14} />
          </button>
          <button
            class="rf-terminal-find__button"
            type="button"
            aria-label="Close find"
            onClick={closeFind}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </Show>
      <Show when={paletteOpen()}>
        <div class="rf-terminal-palette">
          <div class="rf-terminal-palette__inputrow">
            <Icon name="terminal" size={14} />
            <input
              ref={paletteInput}
              class="rf-terminal-palette__input"
              value={paletteQuery()}
              placeholder="Command"
              onInput={(event) => {
                setPaletteQuery(event.currentTarget.value);
                setPaletteIndex(0);
              }}
              onKeyDown={(event) => {
                const items = paletteItems();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closePalette();
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setPaletteIndex((idx) => Math.min(idx + 1, Math.max(0, items.length - 1)));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setPaletteIndex((idx) => Math.max(0, idx - 1));
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  choosePaletteItem(items[paletteIndex()]);
                }
              }}
            />
          </div>
          <div class="rf-terminal-palette__list">
            <For each={paletteItems()}>
              {(item, idx) => (
                <button
                  type="button"
                  class="rf-terminal-palette__item"
                  data-active={idx() === paletteIndex()}
                  onMouseEnter={() => setPaletteIndex(idx())}
                  onClick={() => choosePaletteItem(item)}
                >
                  <span class="rf-terminal-palette__cmd">{item.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={historyOpen()}>
        <div class="rf-terminal-history">
          <div class="rf-terminal-history__inputrow">
            <Icon name="history" size={14} />
            <input
              ref={historyInput}
              class="rf-terminal-history__input"
              value={historyQuery()}
              placeholder="History"
              onInput={(event) => {
                setHistoryQuery(event.currentTarget.value);
                setHistoryIndex(0);
              }}
              onKeyDown={(event) => {
                const items = historyItems();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeHistory();
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHistoryIndex((idx) => Math.min(idx + 1, Math.max(0, items.length - 1)));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHistoryIndex((idx) => Math.max(0, idx - 1));
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  chooseHistoryItem(items[historyIndex()]);
                }
              }}
            />
          </div>
          <div class="rf-terminal-history__list">
            <For each={historyItems()}>
              {(item, idx) => (
                <button
                  type="button"
                  class="rf-terminal-history__item"
                  data-active={idx() === historyIndex()}
                  data-exit={item.exitCode ?? 'running'}
                  onMouseEnter={() => setHistoryIndex(idx())}
                  onClick={() => chooseHistoryItem(item)}
                >
                  <span class="rf-terminal-history__cmd">{item.command}</span>
                  <span class="rf-terminal-history__meta">
                    {item.cwd} · {item.mode} · {item.durationMs}ms
                  </span>
                </button>
              )}
            </For>
            <Show when={historyItems().length === 0}>
              <div class="rf-terminal-history__empty">No matches</div>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={autocomplete()}>
        {(state) => (
          <div class="rf-terminal-autocomplete">
            <For each={state().items}>
              {(item, idx) => (
                <button
                  type="button"
                  class="rf-terminal-autocomplete__item"
                  data-active={idx() === state().index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setAutocomplete({ ...state(), index: idx() })}
                  onClick={() => chooseAutocompleteItem({ ...state(), index: idx() })}
                >
                  <span class="rf-terminal-autocomplete__label">{item.display ?? item.value}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={busyNotice()}>
        <output class="rf-terminal-busy" data-testid="terminal-busy-notice">
          Running command owns stdin · Ctrl+C interrupts
        </output>
      </Show>
      <Show when={quickFix()}>
        {(fix) => (
          <button
            type="button"
            class="rf-terminal-quickfix"
            onClick={() => {
              setQuickFix(null);
              stderrTail = '';
              if (fix().interruptBeforeRun) props.onSignal?.();
              void term?.submitLine(fix().command);
            }}
          >
            <span class="rf-terminal-quickfix__dot" />
            {fix().label}
          </button>
        )}
      </Show>
    </div>
  );
}
