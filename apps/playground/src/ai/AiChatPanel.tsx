/**
 * AI chat panel (ADR-0190 "+chat" view): right-side panel next to the editor/
 * preview. Streams assistant text live, renders each tool call as
 * name + args + collapsed (expandable) result, marks errors visibly, and
 * carries the session controls: send (Enter) / Stop / Reset / Export session /
 * settings (baseUrl / apiKey / model against any OpenAI-compatible endpoint).
 */
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { Icon } from '../components/icons.tsx';
import type { AiAppContext } from './app-context.ts';
import { PROMPT_PROFILE_ID } from './prompt-profile.ts';
import { type AiRunStatus, type AiSession, createAiSession } from './session.ts';
import { type AiSettings, type StorageLike, loadAiSettings, saveAiSettings } from './settings.ts';

type ChatItem =
  | { kind: 'text'; id: number; role: 'user' | 'assistant'; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: number;
      toolCallId: string;
      name: string;
      args: unknown;
      result?: string;
      isError?: boolean;
      done: boolean;
    }
  | { kind: 'notice'; id: number; tone: 'error' | 'budget' | 'info'; text: string };

function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function safeLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function AiChatPanel(props: { ctx: AiAppContext; onClose(): void }) {
  const storage = safeLocalStorage();
  const [settings, setSettings] = createSignal<AiSettings>(loadAiSettings(storage));
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [items, setItems] = createSignal<ChatItem[]>([]);
  const [status, setStatus] = createSignal<AiRunStatus>('idle');
  const [statusDetail, setStatusDetail] = createSignal<string | null>(null);
  const [input, setInput] = createSignal('');
  // Signal, not a plain let: JSX (Export disabled state, Stop wiring) must
  // react when a session appears/disappears.
  const [session, setSession] = createSignal<AiSession | null>(null);
  let unsubscribe: (() => void) | null = null;
  let nextId = 1;
  let listEl: HTMLDivElement | undefined;

  // Distributive omit: `Omit<union, 'id'>` collapses the discriminated union.
  type NewChatItem = ChatItem extends infer T
    ? T extends ChatItem
      ? Omit<T, 'id'>
      : never
    : never;
  function pushItem(item: NewChatItem): void {
    setItems((prev) => [...prev, { ...item, id: nextId++ } as ChatItem]);
    queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }));
  }

  function patchLast(
    match: (item: ChatItem) => boolean,
    patch: (item: ChatItem) => ChatItem,
  ): void {
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const item = prev[i];
        if (item && match(item)) {
          const next = [...prev];
          next[i] = patch(item);
          return next;
        }
      }
      return prev;
    });
  }

  function onAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start': {
        const role = (event.message as { role?: unknown }).role;
        if (role === 'user') {
          pushItem({
            kind: 'text',
            role: 'user',
            text: extractText(event.message),
            streaming: false,
          });
        } else if (role === 'assistant') {
          pushItem({ kind: 'text', role: 'assistant', text: '', streaming: true });
        }
        break;
      }
      case 'message_update': {
        const streamEvent = event.assistantMessageEvent;
        if (streamEvent.type === 'text_delta') {
          patchLast(
            (item) => item.kind === 'text' && item.role === 'assistant' && item.streaming,
            (item) =>
              item.kind === 'text' ? { ...item, text: item.text + streamEvent.delta } : item,
          );
          listEl?.scrollTo({ top: listEl.scrollHeight });
        }
        break;
      }
      case 'message_end': {
        const role = (event.message as { role?: unknown }).role;
        if (role === 'assistant') {
          const text = extractText(event.message);
          patchLast(
            (item) => item.kind === 'text' && item.role === 'assistant' && item.streaming,
            (item) => (item.kind === 'text' ? { ...item, text, streaming: false } : item),
          );
          // Drop an empty assistant bubble (tool-call-only turns have no text).
          setItems((prev) =>
            prev.filter(
              (item) => !(item.kind === 'text' && item.role === 'assistant' && item.text === ''),
            ),
          );
        }
        break;
      }
      case 'tool_execution_start':
        pushItem({
          kind: 'tool',
          toolCallId: event.toolCallId,
          name: event.toolName,
          args: event.args,
          done: false,
        });
        break;
      case 'tool_execution_end':
        patchLast(
          (item) => item.kind === 'tool' && item.toolCallId === event.toolCallId,
          (item) =>
            item.kind === 'tool'
              ? {
                  ...item,
                  done: true,
                  isError: event.isError,
                  result: extractText(event.result) || '(empty result)',
                }
              : item,
        );
        break;
      default:
        break;
    }
  }

  function bindSession(next: AiSession): void {
    unsubscribe?.();
    setSession(next);
    unsubscribe = next.subscribe((event) => {
      if (event.type === 'agent') {
        onAgentEvent(event.event);
        return;
      }
      setStatus(event.status);
      setStatusDetail(event.detail);
      if (event.status === 'budget-exceeded' && event.detail) {
        pushItem({ kind: 'notice', tone: 'budget', text: event.detail });
      } else if (event.status === 'error' && event.detail) {
        pushItem({ kind: 'notice', tone: 'error', text: event.detail });
      }
    });
  }

  function disposeSession(): void {
    unsubscribe?.();
    unsubscribe = null;
    session()?.dispose();
    setSession(null);
  }
  onCleanup(disposeSession);

  function handleSend(): void {
    const text = input().trim();
    if (text === '' || status() === 'running') return;
    if (session() === null) {
      try {
        bindSession(
          createAiSession({
            ctx: props.ctx,
            settings: settings(),
            origin: globalThis.location?.origin ?? 'http://localhost',
          }),
        );
      } catch (err) {
        pushItem({ kind: 'notice', tone: 'error', text: (err as Error).message });
        setSettingsOpen(true);
        return;
      }
    }
    setInput('');
    const active = session();
    if (active) {
      void active.send(text).catch((err: unknown) => {
        pushItem({ kind: 'notice', tone: 'error', text: (err as Error).message });
      });
    }
  }

  function handleReset(): void {
    disposeSession();
    setItems([]);
    setStatus('idle');
    setStatusDetail(null);
  }

  async function handleExport(): Promise<void> {
    const active = session();
    if (!active) return;
    const trace = await active.exportTrace();
    const doc = globalThis.document;
    if (!doc) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = 'rifty-ai-session.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function saveSettingsForm(next: AiSettings): void {
    saveAiSettings(storage, next);
    setSettings(next);
    setSettingsOpen(false);
    if (session() !== null && status() !== 'running') {
      disposeSession();
      pushItem({
        kind: 'notice',
        tone: 'info',
        text: 'Settings updated — the next message starts a fresh session',
      });
    }
  }

  const statusLabel = (): string => {
    const s = status();
    if (s === 'running') return 'running…';
    if (s === 'budget-exceeded') return 'budget exceeded';
    return s;
  };

  return (
    <section class="rf-ai rf-card" data-testid="ai-panel" aria-label="AI agent chat">
      <header class="rf-ai__head">
        <span class="rf-ai__title" title={`prompt profile: ${PROMPT_PROFILE_ID}`}>
          <Icon name="zap" size={13} />
          AI agent
        </span>
        <span
          class="rf-ai__status"
          data-status={status()}
          data-testid="ai-status"
          title={statusDetail() ?? undefined}
        >
          {statusLabel()}
        </span>
        <span class="rf-spacer" />
        <button
          type="button"
          class="rf-iconbtn"
          title="Export session trace (JSON)"
          aria-label="Export session"
          data-testid="ai-export"
          disabled={session() === null}
          onClick={() => void handleExport()}
        >
          <Icon name="file-arrow-down" size={14} />
        </button>
        <button
          type="button"
          class="rf-iconbtn"
          title="Reset chat (new session)"
          aria-label="Reset chat"
          data-testid="ai-reset"
          onClick={handleReset}
        >
          <Icon name="rotate-ccw" size={14} />
        </button>
        <button
          type="button"
          class="rf-iconbtn"
          title="AI settings"
          aria-label="AI settings"
          aria-expanded={settingsOpen()}
          data-testid="ai-settings-open"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Icon name="ellipsis" size={14} />
        </button>
        <button
          type="button"
          class="rf-iconbtn"
          title="Close AI panel"
          aria-label="Close AI panel"
          data-testid="ai-close"
          onClick={() => props.onClose()}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <Show when={settingsOpen()}>
        <AiSettingsForm settings={settings()} onSave={saveSettingsForm} />
      </Show>

      <div class="rf-ai__list" ref={listEl} data-testid="ai-messages">
        <Show when={items().length === 0}>
          <p class="rf-ai__empty">
            Chat with an agent that edits this workspace: it can run shell commands, read and write
            files, and apply patches. Configure the endpoint under settings first.
          </p>
        </Show>
        <For each={items()}>
          {(item) => {
            if (item.kind === 'text') {
              return (
                <div class="rf-ai__msg" data-role={item.role} data-testid="ai-msg">
                  <span class="rf-ai__role">{item.role === 'user' ? 'you' : 'agent'}</span>
                  <div class="rf-ai__text" data-streaming={item.streaming}>
                    {item.text}
                  </div>
                </div>
              );
            }
            if (item.kind === 'tool') {
              return (
                <details
                  class="rf-ai__tool"
                  data-testid="ai-tool-card"
                  data-tool={item.name}
                  data-error={item.isError === true}
                >
                  <summary class="rf-ai__toolhead">
                    <span class="rf-ai__toolname">
                      {item.name}
                      <Show when={!item.done}> ⋯</Show>
                      <Show when={item.isError === true}>
                        <span class="rf-ai__toolerr"> error</span>
                      </Show>
                    </span>
                    <code class="rf-ai__toolargs">{formatArgs(item.args)}</code>
                  </summary>
                  <pre class="rf-ai__toolresult">{item.result ?? '(running)'}</pre>
                </details>
              );
            }
            return (
              <div class="rf-ai__notice" data-tone={item.tone} data-testid="ai-notice">
                {item.text}
              </div>
            );
          }}
        </For>
      </div>

      <footer class="rf-ai__input">
        <textarea
          class="rf-ai__textarea"
          data-testid="ai-input"
          placeholder="Ask the agent… (Enter to send, Shift+Enter for a new line)"
          rows={2}
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Show
          when={status() === 'running'}
          fallback={
            <button
              type="button"
              class="rf-ai__send"
              data-testid="ai-send"
              disabled={input().trim() === ''}
              onClick={handleSend}
            >
              Send
            </button>
          }
        >
          <button
            type="button"
            class="rf-ai__stop"
            data-testid="ai-stop"
            onClick={() => session()?.stop()}
          >
            Stop
          </button>
        </Show>
      </footer>
    </section>
  );
}

function AiSettingsForm(props: {
  settings: AiSettings;
  onSave(next: AiSettings): void;
}) {
  const [baseUrl, setBaseUrl] = createSignal(props.settings.baseUrl);
  const [apiKey, setApiKey] = createSignal(props.settings.apiKey);
  const [model, setModel] = createSignal(props.settings.model);

  return (
    <form
      class="rf-ai__settings"
      data-testid="ai-settings"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({
          ...props.settings,
          baseUrl: baseUrl().trim(),
          apiKey: apiKey().trim(),
          model: model().trim(),
        });
      }}
    >
      <label class="rf-ai__field">
        <span>Base URL</span>
        <input
          type="text"
          data-testid="ai-settings-baseurl"
          placeholder="https://api.openai.com/v1"
          value={baseUrl()}
          onInput={(e) => setBaseUrl(e.currentTarget.value)}
        />
      </label>
      <label class="rf-ai__field">
        <span>API key</span>
        <input
          type="password"
          data-testid="ai-settings-key"
          autocomplete="off"
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
        />
      </label>
      <label class="rf-ai__field">
        <span>Model</span>
        <input
          type="text"
          data-testid="ai-settings-model"
          placeholder="gpt-4.1-mini"
          value={model()}
          onInput={(e) => setModel(e.currentTarget.value)}
        />
      </label>
      <p class="rf-ai__hint">
        The key is stored in plaintext in this browser's localStorage and leaves the browser only in
        the Authorization header of requests to the Base URL. It never appears in session traces or
        exports. CORS-blocked provider? Dev-only escape hatch: start the playground with{' '}
        <code>RIFTY_AI_PROXY_TARGET=&lt;provider origin&gt;</code> and set Base URL to
        <code> /ai-proxy/v1</code>.
      </p>
      <button type="submit" class="rf-ai__save" data-testid="ai-settings-save">
        Save settings
      </button>
    </form>
  );
}
