import type { TerminalCompletionResult } from '@riftydev/terminal';
import '@xterm/xterm/css/xterm.css';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { TerminalPanel } from '../components/TerminalPanel.tsx';
import '../styles/theme.css';

interface PendingCompletion {
  readonly resolve: (result: TerminalCompletionResult | null) => void;
  readonly reject: (error: unknown) => void;
}

type CompletionAwareTerminalPanelProps = Parameters<typeof TerminalPanel>[0] & {
  readonly onCompletionError?: (error: unknown) => void;
};

let pendingCompletions: PendingCompletion[] = [];
let publishPendingCount: ((count: number) => void) | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function takePendingCompletion(): PendingCompletion {
  const pending = pendingCompletions.shift();
  if (!pending) throw new Error('terminal completion harness has no pending request');
  publishPendingCount?.(pendingCompletions.length);
  return pending;
}

/** Mounts the real TerminalPanel and leaves only its owner completer controllable. */
export function mountTerminalCompletionHarness(root: HTMLElement): void {
  pendingCompletions = [];
  const [pendingCount, setPendingCount] = createSignal(0);
  const [completionError, setCompletionError] = createSignal<string>();
  publishPendingCount = setPendingCount;

  const panelProps: CompletionAwareTerminalPanelProps = {
    attach: () => {},
    onLine: () => 0,
    testId: 'terminal-completion-input',
    completer: () =>
      new Promise<TerminalCompletionResult | null>((resolve, reject) => {
        pendingCompletions.push({ resolve, reject });
        setPendingCount(pendingCompletions.length);
      }),
    onCompletionError: (error) => {
      setCompletionError(`Completion failed: ${errorMessage(error)}`);
    },
  };

  render(
    () => (
      <div
        data-testid="terminal-completion-harness"
        data-pending-completions={pendingCount()}
        style={{ position: 'relative', width: '800px', height: '280px' }}
      >
        <TerminalPanel {...panelProps} />
        <Show when={completionError()}>
          {(message) => (
            <output
              data-testid="terminal-completion-error"
              style={{ position: 'absolute', top: '8px', left: '8px', 'z-index': 10 }}
            >
              {message()}
            </output>
          )}
        </Show>
      </div>
    ),
    root,
  );
}

export function resolveTerminalCompletion(result: TerminalCompletionResult): void {
  takePendingCompletion().resolve(result);
}

export function rejectTerminalCompletion(message: string): void {
  takePendingCompletion().reject(new Error(message));
}
