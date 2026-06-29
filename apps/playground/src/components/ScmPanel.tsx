import type { LogEntry } from '@riftydev/git';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { type ScmResourceRow, scmRowsFromStatusMap } from '../glue/scm-status.ts';
import { Icon } from './icons.tsx';

function commitSubject(entry: LogEntry): string {
  return entry.message.split('\n')[0] || '(no subject)';
}

function shortOid(entry: LogEntry): string {
  return entry.oid.slice(0, 7);
}

function ResourceGroup(props: {
  kind: 'staged' | 'changes';
  title: string;
  rows: readonly ScmResourceRow[];
  onOpen(row: ScmResourceRow): void;
  onStage(row: ScmResourceRow): Promise<void>;
  onUnstage(row: ScmResourceRow): Promise<void>;
  onDiscard(row: ScmResourceRow): Promise<void>;
  pendingKey?: string;
  runAction(kind: 'stage' | 'unstage' | 'discard', row: ScmResourceRow): void;
}) {
  const canDiscard = (row: ScmResourceRow): boolean => row.badge !== 'U';
  return (
    <section class="rf-scm__group">
      <h3 class="rf-scm__group-title">
        {props.title}
        <span class="rf-scm__count">{props.rows.length}</span>
      </h3>
      <Show when={props.rows.length > 0} fallback={<p class="rf-scm__empty">No files</p>}>
        <div class="rf-scm__rows">
          <For each={props.rows}>
            {(row) => (
              <div
                class="rf-scm__row"
                data-code={row.badge}
                title={`rifty-git status: ${row.code} ${row.relativePath}`}
              >
                <button type="button" class="rf-scm__open" onClick={() => props.onOpen(row)}>
                  <span class="rf-scm__badge" aria-hidden="true">
                    {row.badge}
                  </span>
                  <span class="rf-scm__path">{row.relativePath}</span>
                </button>
                <span class="rf-scm__actions">
                  <Show
                    when={props.kind === 'staged'}
                    fallback={
                      <>
                        <button
                          type="button"
                          class="rf-iconbtn rf-iconbtn--xs"
                          title={`Stage ${row.relativePath}`}
                          aria-label={`Stage ${row.relativePath}`}
                          disabled={props.pendingKey !== undefined}
                          onClick={() => props.runAction('stage', row)}
                        >
                          <Icon name="plus" size={12} />
                        </button>
                        <Show when={canDiscard(row)}>
                          <button
                            type="button"
                            class="rf-iconbtn rf-iconbtn--xs"
                            title={`Discard ${row.relativePath}`}
                            aria-label={`Discard ${row.relativePath}`}
                            disabled={props.pendingKey !== undefined}
                            onClick={() => props.runAction('discard', row)}
                          >
                            <Icon name="arrow-rotate-left" size={12} />
                          </button>
                        </Show>
                      </>
                    }
                  >
                    <button
                      type="button"
                      class="rf-iconbtn rf-iconbtn--xs"
                      title={`Unstage ${row.relativePath}`}
                      aria-label={`Unstage ${row.relativePath}`}
                      disabled={props.pendingKey !== undefined}
                      onClick={() => props.runAction('unstage', row)}
                    >
                      <Icon name="arrow-rotate-left" size={12} />
                    </button>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

export function ScmPanel(props: {
  root: string;
  branch?: string;
  status: ReadonlyMap<string, string>;
  history: readonly LogEntry[];
  onOpenChange(row: ScmResourceRow): void;
  onStage(row: ScmResourceRow): Promise<void>;
  onUnstage(row: ScmResourceRow): Promise<void>;
  onDiscard(row: ScmResourceRow): Promise<void>;
  onCommit(message: string): Promise<void>;
}) {
  const groups = createMemo(() => scmRowsFromStatusMap(props.status, props.root));
  const [pendingKey, setPendingKey] = createSignal<string | undefined>();
  const [commitMessage, setCommitMessage] = createSignal('');
  const [commitPending, setCommitPending] = createSignal(false);

  async function runAction(
    kind: 'stage' | 'unstage' | 'discard',
    row: ScmResourceRow,
  ): Promise<void> {
    const key = `${kind}:${row.path}:${row.code}`;
    if (pendingKey() !== undefined) return;
    setPendingKey(key);
    try {
      if (kind === 'stage') await props.onStage(row);
      else if (kind === 'unstage') await props.onUnstage(row);
      else await props.onDiscard(row);
    } catch {
      // App owns the user-visible error; this panel only owns pending state.
    } finally {
      setPendingKey(undefined);
    }
  }

  async function submitCommit(): Promise<void> {
    if (commitPending()) return;
    const message = commitMessage();
    if (message.trim().length === 0) return;
    setCommitPending(true);
    try {
      await props.onCommit(message);
      setCommitMessage('');
    } catch {
      // App owns the user-visible error; keep the message for retry.
    } finally {
      setCommitPending(false);
    }
  }

  return (
    <div class="rf-scm" aria-label="Git">
      <div class="rf-explorer__head">
        <span class="rf-explorer__title">GIT</span>
        <Show when={props.branch}>
          {(branch) => <span class="rf-scm__branch">{branch()}</span>}
        </Show>
      </div>

      <div class="rf-scm__scroll">
        <form
          class="rf-scm__commit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCommit();
          }}
        >
          <textarea
            class="rf-scm__message"
            aria-label="Commit message"
            rows={3}
            value={commitMessage()}
            disabled={commitPending()}
            onInput={(e) => setCommitMessage(e.currentTarget.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submitCommit();
              }
            }}
          />
          <button
            type="submit"
            class="rf-scm__commitbtn"
            disabled={commitPending() || commitMessage().trim().length === 0}
          >
            <Icon name="check" size={13} />
            Commit
          </button>
        </form>
        <ResourceGroup
          kind="staged"
          title="Staged Changes"
          rows={groups().staged}
          onOpen={props.onOpenChange}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={props.onDiscard}
          pendingKey={pendingKey()}
          runAction={(kind, row) => void runAction(kind, row)}
        />
        <ResourceGroup
          kind="changes"
          title="Changes"
          rows={groups().changes}
          onOpen={props.onOpenChange}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={props.onDiscard}
          pendingKey={pendingKey()}
          runAction={(kind, row) => void runAction(kind, row)}
        />

        <section class="rf-scm__group">
          <h3 class="rf-scm__group-title">History</h3>
          <Show when={props.history.length > 0} fallback={<p class="rf-scm__empty">No commits</p>}>
            <div class="rf-scm__history">
              <For each={props.history}>
                {(entry) => (
                  <div class="rf-scm__commit" title={entry.oid}>
                    <span class="rf-scm__oid">{shortOid(entry)}</span>
                    <span class="rf-scm__subject">{commitSubject(entry)}</span>
                    <span class="rf-scm__author">{entry.author.name}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
