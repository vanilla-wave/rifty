import {
  type AgentCapabilities,
  type AgentHost,
  createBrowserAgentPreview,
  createWorkbenchAgentHost,
} from '@riftydev/agent';
import type { ProjectTerminal } from '@riftydev/workbench';
import type { PlaygroundAppProjectContext } from '../adapters/playground-app-runtime.ts';
import type { PlaygroundTerminalUi } from '../adapters/playground-terminal-ui.ts';
import type { PreviewPanelTarget } from '../components/PreviewPanel.tsx';

export interface PlaygroundAgentOptions {
  readonly context: PlaygroundAppProjectContext;
  readonly terminalUi: PlaygroundTerminalUi;
  readonly preview: () => PreviewPanelTarget | undefined;
  readonly showTerminal: () => void;
}

export function createPlaygroundAgentHost(options: PlaygroundAgentOptions): AgentHost {
  let owned: { id: string; terminal: ProjectTerminal } | undefined;
  const ensureTerminal = () => {
    if (!owned || !options.terminalUi.sessions().some((entry) => entry.id === owned?.id)) {
      const terminal = options.context.session.terminals.open();
      const { id } = options.terminalUi.createSession('Agent', terminal);
      owned = { id, terminal };
    }
    return owned;
  };
  const base = createWorkbenchAgentHost({
    session: options.context.session,
    terminal: ensureTerminal().terminal,
    companion: options.context.tools,
    preview: () => {
      const current = options.preview();
      return current
        ? createBrowserAgentPreview({
            url: () => new URL(current.url, current.frame.ownerDocument.baseURI).href,
            frame: () => current.frame,
          })
        : undefined;
    },
  });
  const shell: NonNullable<AgentCapabilities['shell']> = async (command, signal, onOutput) => {
    signal?.throwIfAborted();
    const { id, terminal } = ensureTerminal();
    options.terminalUi.select(id);
    options.showTerminal();
    let stdout = '';
    let stderr = '';
    const detach = terminal.attach((chunk, stream) => {
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
      onOutput(chunk, stream);
    });
    const stop = () => {
      void options.terminalUi.stop(id).catch(() => {});
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const running = options.terminalUi.presentLine(id, command, signal);
      if (signal?.aborted) stop();
      const exitCode = await running;
      return { status: signal?.aborted ? 'cancelled' : 'exited', exitCode, stdout, stderr };
    } finally {
      signal?.removeEventListener('abort', stop);
      detach();
    }
  };
  return {
    root: base.root,
    capabilities: () => ({ ...base.capabilities(), shell }),
    async close() {
      await base.close();
      if (owned && options.terminalUi.sessions().some((entry) => entry.id === owned?.id))
        await options.terminalUi.closeSession(owned.id);
    },
  };
}
