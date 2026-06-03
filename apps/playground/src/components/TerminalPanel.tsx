import { RiftyTerminal } from '@riftydev/terminal';
import { onCleanup, onMount } from 'solid-js';

export function TerminalPanel(props: {
  attach(write: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  onLine(line: string): void | Promise<void>;
}) {
  let container: HTMLDivElement | undefined;
  let term: RiftyTerminal | undefined;

  onMount(() => {
    if (!container) return;
    term = new RiftyTerminal({
      onInput: (line) => props.onLine(line),
    });
    term.mount(container);
    props.attach((chunk, stream) => term?.write(chunk, stream));
  });

  onCleanup(() => term?.dispose());

  return <div ref={container} class="rf-terminal" data-testid="terminal" />;
}
