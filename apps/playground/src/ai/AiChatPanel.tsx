import {
  type AgentEvent,
  type AgentHost,
  type AgentMessage,
  type AgentResourceReport,
  type AgentSession,
  type AgentStatus,
  type AgentTrace,
  createAgentSession,
} from '@riftydev/agent';
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { downloadBlob } from '../glue/download.ts';
import { ResourceReport } from './ResourceReport.tsx';
import { type PlaygroundAgentOptions, createPlaygroundAgentHost } from './playground-agent-host.ts';
import { type ChatSettings, loadSettings, saveSettings, validateSettings } from './settings.ts';
import './chat.css';

type ChatItem =
  | {
      readonly kind: 'message';
      readonly id: number;
      readonly role: 'user' | 'assistant';
      readonly text: string;
    }
  | {
      readonly kind: 'tool';
      readonly id: number;
      readonly callId: string;
      readonly name: string;
      readonly args: unknown;
      readonly running?: boolean;
      readonly result?: string;
      readonly isError?: boolean;
    };

interface ActiveSession {
  readonly agent: AgentSession;
  readonly host: AgentHost;
  readonly detach: () => void;
}

// agent-bench hook: external validation harness only. Not public API.
interface BenchHook {
  seed(input: {
    readonly taskId: string;
    readonly files: Readonly<Record<string, string>>;
  }): Promise<void>;
  exportTrace(): Promise<AgentTrace>;
  sessionMetadata(): Promise<{
    readonly taskId?: string;
    readonly model: string;
    readonly profile: string;
    readonly maxToolCalls: number;
    readonly runTimeoutMs: number;
  }>;
}

function messageText(message: AgentMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const json = (value: unknown) => JSON.stringify(value, null, 2) ?? String(value);

function playgroundAgentDetail(detail: string): string {
  return /failed to fetch|fetch failed|networkerror|connection error/i.test(detail)
    ? `${detail}. Browser endpoint access failed; for CORS use the playground dev proxy (RIFTY_AI_PROXY_TARGET, Base URL /ai-proxy/v1).`
    : detail;
}

interface ToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly details?: unknown;
}

function resultText(result: ToolResult): string {
  const text = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
  return result.details === undefined
    ? text
    : `${text}${text ? '\n\n' : ''}${json(result.details)}`;
}

export function AiChatPanel(props: PlaygroundAgentOptions & { readonly onClose: () => void }) {
  const [settings, setSettings] = createSignal(loadSettings());
  const [draft, setDraft] = createSignal<ChatSettings>({ ...settings() });
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [rows, setRows] = createStore<ChatItem[]>([]);
  const items = () => rows;
  const setItems = (
    update: readonly ChatItem[] | ((current: readonly ChatItem[]) => readonly ChatItem[]),
  ) => {
    const next = typeof update === 'function' ? update(rows) : update;
    setRows(reconcile([...next], { key: 'id' }));
  };
  const [status, setStatus] = createSignal<AgentStatus>('idle');
  const [detail, setDetail] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [resources, setResources] = createSignal<AgentResourceReport>();
  const [reloaded, setReloaded] = createSignal(false);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [hasSession, setHasSession] = createSignal(false);
  let active: ActiveSession | undefined;
  let assistantIndex = -1;
  let runStart = 0;
  let nextMessageId = 1;
  let alive = true;
  let taskId: string | undefined;
  let list: HTMLDivElement | undefined;
  let followOutput = true;
  const running = () => status() === 'running' || busy();

  createEffect(() => {
    items().map((item) => (item.kind === 'message' ? item.text : item.result));
    if (followOutput)
      queueMicrotask(() => {
        if (list?.isConnected) list.scrollTop = list.scrollHeight;
      });
  });

  function receive(event: AgentEvent) {
    if (!alive) return;
    if (
      event.type === 'message_start' &&
      (event.message.role === 'user' || event.message.role === 'assistant')
    ) {
      if (event.message.role === 'assistant') assistantIndex = items().length;
      setItems((current) => [
        ...current,
        {
          kind: 'message',
          id: nextMessageId++,
          role: event.message.role as 'user' | 'assistant',
          text: messageText(event.message),
        },
      ]);
    } else if (
      (event.type === 'message_update' || event.type === 'message_end') &&
      event.message.role === 'assistant'
    ) {
      setItems((current) =>
        current.map((item, index) =>
          index === assistantIndex && item.kind === 'message'
            ? { ...item, text: messageText(event.message) }
            : item,
        ),
      );
      if (
        event.type === 'message_end' &&
        event.message.stopReason !== 'error' &&
        event.message.stopReason !== 'aborted'
      ) {
        const calls: ChatItem[] = event.message.content
          .filter((part) => part.type === 'toolCall')
          .map((call) => ({
            kind: 'tool',
            id: nextMessageId++,
            callId: call.id,
            name: call.name,
            args: structuredClone(call.arguments),
          }));
        setItems((current) => [...current, ...calls]);
      }
    } else if (event.type === 'tool_execution_start') {
      const index = items().findIndex(
        (item) =>
          item.kind === 'tool' &&
          item.callId === event.toolCallId &&
          !item.running &&
          item.result === undefined,
      );
      const fields = { running: true, args: structuredClone(event.args as unknown) };
      setItems((current) =>
        index < 0
          ? [
              ...current,
              {
                kind: 'tool',
                id: nextMessageId++,
                callId: event.toolCallId,
                name: event.toolName,
                ...fields,
              },
            ]
          : current.map((item, offset) => (offset === index ? { ...item, ...fields } : item)),
      );
    } else if (event.type === 'tool_execution_end') {
      const index = items().findIndex(
        (item) =>
          item.kind === 'tool' &&
          item.callId === event.toolCallId &&
          item.running &&
          item.result === undefined,
      );
      setItems((current) =>
        current.map((item, offset) =>
          item.kind === 'tool' && offset === index
            ? {
                ...item,
                result: resultText(event.result as ToolResult),
                isError: event.isError,
                running: false,
              }
            : item,
        ),
      );
    } else if (event.type === 'agent_end') {
      // The core supplies this run's completed history, including skipped Stop calls.
      const current = items().slice(runStart);
      const settled: ChatItem[] = [];
      const id = () => current[settled.length]?.id ?? nextMessageId++;
      for (const message of event.messages) {
        if (message.role === 'user' || message.role === 'assistant') {
          settled.push({
            kind: 'message',
            id: id(),
            role: message.role,
            text: messageText(message),
          });
          if (
            message.role === 'assistant' &&
            message.stopReason !== 'aborted' &&
            message.stopReason !== 'error'
          ) {
            for (const call of message.content.filter((part) => part.type === 'toolCall'))
              settled.push({
                kind: 'tool',
                id: id(),
                callId: call.id,
                name: call.name,
                args: structuredClone(call.arguments),
              });
          }
        } else if (message.role === 'toolResult') {
          const index = settled.findIndex(
            (item) =>
              item.kind === 'tool' &&
              item.callId === message.toolCallId &&
              item.result === undefined,
          );
          const item = settled[index];
          if (item?.kind === 'tool')
            settled[index] = { ...item, result: resultText(message), isError: message.isError };
        }
      }
      setItems([...items().slice(0, runStart), ...settled]);
    }
  }

  function ensureSession(): ActiveSession {
    if (active) return active;
    const selected = validateSettings(settings());
    const host = createPlaygroundAgentHost(props);
    try {
      const { maxToolCalls, runTimeoutMs, ...transportSettings } = selected;
      const agent = createAgentSession({
        host,
        settings: transportSettings,
        maxToolCalls,
        runTimeoutMs,
      });
      const detach = agent.subscribe((event) => {
        if (!alive) return;
        if (event.type === 'agent') receive(event.event);
        else if (event.type === 'resources') setResources(event.report);
        else if (event.type === 'status') {
          if (event.status === 'running') runStart = items().length;
          setStatus(event.status);
          setDetail(playgroundAgentDetail(event.detail ?? ''));
        }
      });
      active = { agent, host, detach };
      setHasSession(true);
      return active;
    } catch (error) {
      void host
        .close()
        .catch((closeError: unknown) => console.error('[agent] host close failed', closeError));
      throw error;
    }
  }

  async function endSession() {
    const previous = active;
    active = undefined;
    setHasSession(false);
    setResources(undefined);
    setReloaded(false);
    previous?.detach();
    await previous?.agent.dispose();
  }

  async function send() {
    const text = input().trim();
    if (!text || running()) return;
    if (text.startsWith('/') && text !== '/reload') {
      // Pi expands /skill:name and /name templates; refuse rather than forward silently.
      setNotice(
        `Unsupported chat command ${text.split(/\s/)[0]}: only /reload is supported; pi skill and prompt-template expansion is not.`,
      );
      return;
    }
    try {
      const current = ensureSession();
      setInput('');
      setNotice('');
      followOutput = true;
      if (text === '/reload') {
        setBusy(true);
        await current.agent.reload();
        setReloaded(true);
      } else await current.agent.send(text);
    } catch (error) {
      setStatus('error');
      setDetail(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (running()) return;
    active?.agent.reset();
    assistantIndex = -1;
    setItems([]);
    setStatus('idle');
    setDetail('');
    setNotice('');
  }

  async function applySettings(event: SubmitEvent) {
    event.preventDefault();
    if (running()) return;
    try {
      const next = validateSettings(draft());
      setBusy(true);
      await endSession();
      if (!alive) return;
      setSettings(next);
      setNotice(
        saveSettings(next)
          ? 'Settings applied. New conversation.'
          : 'Settings not saved; using them in this chat.',
      );
      setSettingsOpen(false);
      setItems([]);
      setStatus('idle');
      setDetail('');
      assistantIndex = -1;
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changeDraft<K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function exportSession() {
    if (!active) return;
    try {
      const trace = await active.agent.exportTrace();
      downloadBlob(
        'rifty-ai-session.json',
        new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }),
      );
    } catch (error) {
      setNotice(`Export failed: ${errorMessage(error)}`);
    }
  }

  // agent-bench hook: external validation harness only. Not public API.
  const hook: BenchHook = {
    async seed(input) {
      if (running()) throw new Error('Benchmark seed requires an idle chat');
      setBusy(true);
      try {
        const files = ensureSession().host.capabilities().files;
        if (!files) throw new Error('Project file capability is unavailable');
        for (const [path, value] of Object.entries(input.files))
          await files.change(path.startsWith('/') ? path : `/${path}`, () => value);
        taskId = input.taskId;
      } finally {
        setBusy(false);
      }
    },
    async exportTrace() {
      if (!active) throw new Error('No agent session');
      return active.agent.exportTrace();
    },
    async sessionMetadata() {
      const trace = await hook.exportTrace();
      if (trace.config.transport !== 'openai-compatible')
        throw new Error('Playground benchmark requires OpenAI-compatible transport');
      return {
        ...(taskId ? { taskId } : {}),
        model: trace.config.model,
        profile: trace.profile,
        maxToolCalls: trace.config.maxToolCalls ?? 100,
        runTimeoutMs: trace.config.runTimeoutMs ?? 180_000,
      };
    },
  };
  // agent-bench hook: external validation harness only. Not public API.
  if (new URLSearchParams(location.search).get('agentBench') === '1')
    Reflect.set(globalThis, '__riftyAgentBench', hook);

  onCleanup(() => {
    alive = false;
    // agent-bench hook: external validation harness only. Not public API.
    if (Reflect.get(globalThis, '__riftyAgentBench') === hook)
      Reflect.deleteProperty(globalThis, '__riftyAgentBench');
    void endSession().catch((error: unknown) => console.error('[agent] close failed', error));
  });

  return (
    <section
      class="rf-ai rf-card"
      data-testid="ai-panel"
      data-status={status()}
      aria-label="AI agent chat"
    >
      <header class="rf-ai__head">
        <div>
          <strong>Chat</strong>
          <span class="rf-ai__status" data-testid="ai-status">
            {busy() ? 'preparing…' : status() === 'budget-exceeded' ? 'budget exceeded' : status()}
          </span>
        </div>
        <button
          type="button"
          class="rf-btn rf-btn--ghost"
          aria-label="Close chat"
          title="Stop and close this conversation"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div class="rf-ai__controls">
        <button
          type="button"
          class="rf-btn rf-btn--ghost"
          disabled={running()}
          onClick={() => {
            setDraft({ ...settings() });
            setSettingsOpen((open) => !open);
          }}
        >
          Settings
        </button>
        <button type="button" class="rf-btn rf-btn--ghost" disabled={running()} onClick={reset}>
          Reset
        </button>
        <button
          type="button"
          class="rf-btn rf-btn--ghost"
          disabled={!hasSession() || busy()}
          onClick={() => void exportSession()}
        >
          Export session
        </button>
      </div>
      <Show when={settingsOpen()}>
        <form class="rf-ai__settings" onSubmit={(event) => void applySettings(event)}>
          <fieldset disabled={running()}>
            <label>
              Base URL
              <input
                value={draft().baseUrl}
                onInput={(event) => changeDraft('baseUrl', event.currentTarget.value)}
                placeholder="/ai-proxy/v1"
                required
              />
            </label>
            <label>
              Model
              <input
                value={draft().model}
                onInput={(event) => changeDraft('model', event.currentTarget.value)}
                required
              />
            </label>
            <label>
              API key (optional)
              <input
                type="password"
                autocomplete="off"
                value={draft().apiKey}
                onInput={(event) => changeDraft('apiKey', event.currentTarget.value)}
              />
            </label>
            <small>Only endpoint and model are saved. Key and limits stay in this chat.</small>
            <div class="rf-ai__limits">
              <label>
                Tool limit
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft().maxToolCalls}
                  onInput={(event) =>
                    changeDraft('maxToolCalls', Number(event.currentTarget.value))
                  }
                  required
                />
              </label>
              <label>
                Time limit (seconds)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft().runTimeoutMs / 1000}
                  onInput={(event) =>
                    changeDraft('runTimeoutMs', Number(event.currentTarget.value) * 1000)
                  }
                  required
                />
              </label>
            </div>
            <button type="submit" class="rf-btn">
              Apply and reset chat
            </button>
          </fieldset>
        </form>
      </Show>
      <Show when={resources()}>
        {(report) => <ResourceReport report={report()} reloaded={reloaded()} />}
      </Show>
      <Show when={notice()}>
        <output class="rf-ai__notice">{notice()}</output>
      </Show>
      <Show when={detail()}>
        <p class="rf-ai__error" role="alert">
          {detail()}
        </p>
      </Show>
      <div
        class="rf-ai__messages"
        data-testid="ai-messages"
        ref={list}
        onScroll={() => {
          if (list) followOutput = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
        }}
      >
        <Show when={items().length === 0}>
          <p class="rf-ai__empty">
            Edit this project with an agent. Configure your endpoint and model in Settings, then
            send a request.
          </p>
        </Show>
        <For each={items()}>
          {(item) =>
            item.kind === 'message' ? (
              <Show when={item.text}>
                <article class="rf-ai__message" data-role={item.role}>
                  <small>{item.role === 'user' ? 'you' : 'agent'}</small>
                  <p>{item.text}</p>
                </article>
              </Show>
            ) : (
              <article
                class="rf-ai__tool"
                data-tool-name={item.name}
                data-state={
                  item.result === undefined
                    ? item.running
                      ? 'running'
                      : 'pending'
                    : item.isError
                      ? 'error'
                      : 'done'
                }
              >
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.result === undefined
                      ? item.running
                        ? 'running…'
                        : 'pending'
                      : item.isError
                        ? 'error'
                        : 'done'}
                  </small>
                </div>
                <pre class="rf-ai__args">
                  {json(item.args).slice(0, 240)}
                  {json(item.args).length > 240 ? '…' : ''}
                </pre>
                <details>
                  <summary>Arguments and result</summary>
                  <pre>{json(item.args)}</pre>
                  <pre data-testid="ai-tool-result">{item.result ?? 'Running…'}</pre>
                </details>
              </article>
            )
          }
        </For>
      </div>
      <form
        class="rf-ai__compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message"
          rows={3}
          value={input()}
          disabled={running()}
          placeholder="What should we change?"
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <small>Enter to send · Shift+Enter for newline</small>
          <Show
            when={status() === 'running'}
            fallback={
              <button type="submit" class="rf-btn" disabled={running() || !input().trim()}>
                Send
              </button>
            }
          >
            <button type="button" class="rf-btn" onClick={() => void active?.agent.stop()}>
              Stop
            </button>
          </Show>
        </div>
      </form>
    </section>
  );
}
