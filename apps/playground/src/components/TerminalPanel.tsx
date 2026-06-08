import { RiftyTerminal } from '@riftydev/terminal';
import { onCleanup, onMount } from 'solid-js';

/** Live terminal dimensions handed to `onLine` so the shell sees `ctx.cols/rows`. */
export interface TerminalDims {
  readonly cols: number;
  readonly rows: number;
}

export function TerminalPanel(props: {
  attach(write: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  onLine(line: string, dims: TerminalDims): void | Promise<void>;
  /** Ctrl+C from the terminal — wire to the shell session's `interrupt()`. */
  onSignal?(): void;
}) {
  let container: HTMLDivElement | undefined;
  let term: RiftyTerminal | undefined;

  onMount(() => {
    if (!container) return;
    term = new RiftyTerminal({
      onInput: (line) => props.onLine(line, { cols: term?.cols ?? 80, rows: term?.rows ?? 24 }),
      onSignal: props.onSignal ? () => props.onSignal?.() : undefined,
    });
    term.mount(container);
    props.attach((chunk, stream) => term?.write(chunk, stream));
  });

  onCleanup(() => term?.dispose());

  return <div ref={container} class="rf-terminal" data-testid="terminal" />;
}
