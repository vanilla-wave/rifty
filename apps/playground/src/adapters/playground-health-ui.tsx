import type {
  WorkbenchHealth,
  WorkbenchHealthIssue,
  WorkbenchHealthSnapshot,
  WorkbenchRecoveryScope,
} from '@riftydev/workbench';
import { type Accessor, For, Show, createSignal } from 'solid-js';

export type PlaygroundBootLifecycle =
  | { readonly kind: 'opening' }
  | { readonly kind: 'boot-failed'; readonly summary: string }
  | { readonly kind: 'open' };

export interface PlaygroundHealthUi {
  readonly boot: Accessor<PlaygroundBootLifecycle>;
  readonly issues: Accessor<readonly WorkbenchHealthIssue[]>;
  readonly issue: Accessor<WorkbenchHealthIssue | undefined>;
  readonly persistenceAtRisk: Accessor<boolean>;
  beginBoot(): void;
  bootFailed(error: unknown): void;
  bindWorkbench(health: WorkbenchHealth): void;
  bindSession(health?: WorkbenchHealth): void;
  recover(scope: WorkbenchRecoveryScope): Promise<void>;
  dispose(): void;
}

const HEALTHY: WorkbenchHealthSnapshot = Object.freeze({ disposition: 'healthy', issues: [] });

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issueRank(issue: WorkbenchHealthIssue): number {
  if (issue.kind === 'fatal') return 0;
  if (issue.kind === 'unavailable') return 1;
  if (issue.scope === 'persistence') return 2;
  if (issue.scope === 'scm') return 3;
  return 4;
}

function hasRecovery(snapshot: WorkbenchHealthSnapshot, scope: WorkbenchRecoveryScope): boolean {
  return snapshot.issues.some((issue) => issue.recovery === scope);
}

/** Page lifecycle owner: one fenced subscription slot per health generation. */
export function createPlaygroundHealthUi(): PlaygroundHealthUi {
  const [revision, setRevision] = createSignal(0);
  let bootState: PlaygroundBootLifecycle = { kind: 'opening' };
  let workbenchSnapshotState = HEALTHY;
  let sessionSnapshotState = HEALTHY;
  let workbenchHealth: WorkbenchHealth | undefined;
  let sessionHealth: WorkbenchHealth | undefined;
  let unsubscribeWorkbench: (() => void) | undefined;
  let unsubscribeSession: (() => void) | undefined;
  let workbenchGeneration = 0;
  let sessionGeneration = 0;
  let disposed = false;

  const changed = (): void => {
    setRevision((value) => value + 1);
  };
  const boot = (): PlaygroundBootLifecycle => {
    revision();
    return bootState;
  };
  const persistenceAtRisk = (): boolean => {
    revision();
    return [...sessionSnapshotState.issues, ...workbenchSnapshotState.issues].some(
      (issue) => issue.scope === 'persistence',
    );
  };

  const admit =
    (
      generation: number,
      currentGeneration: () => number,
      publish: (snapshot: WorkbenchHealthSnapshot) => void,
    ) =>
    (snapshot: WorkbenchHealthSnapshot): void => {
      if (disposed || generation !== currentGeneration()) return;
      publish(snapshot);
      changed();
    };

  const issues = (): readonly WorkbenchHealthIssue[] => {
    revision();
    const seen = new Set<string>();
    return [...sessionSnapshotState.issues, ...workbenchSnapshotState.issues]
      .filter((issue) => {
        const key = `${issue.kind}\0${issue.scope}\0${issue.summary}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => issueRank(left) - issueRank(right));
  };

  const clearSession = (): void => {
    sessionGeneration += 1;
    unsubscribeSession?.();
    unsubscribeSession = undefined;
    sessionHealth = undefined;
    sessionSnapshotState = HEALTHY;
    changed();
  };

  const clearWorkbench = (): void => {
    workbenchGeneration += 1;
    unsubscribeWorkbench?.();
    unsubscribeWorkbench = undefined;
    workbenchHealth = undefined;
    workbenchSnapshotState = HEALTHY;
    changed();
  };

  return {
    boot,
    issues,
    issue: () => issues()[0],
    persistenceAtRisk,
    beginBoot() {
      if (disposed) return;
      clearSession();
      clearWorkbench();
      bootState = { kind: 'opening' };
      changed();
    },
    bootFailed(error) {
      if (disposed) return;
      clearSession();
      clearWorkbench();
      bootState = { kind: 'boot-failed', summary: errorSummary(error) };
      changed();
    },
    bindWorkbench(health) {
      if (disposed) return;
      clearWorkbench();
      workbenchHealth = health;
      const generation = workbenchGeneration;
      bootState = { kind: 'open' };
      changed();
      unsubscribeWorkbench = health.subscribe(
        admit(
          generation,
          () => workbenchGeneration,
          (snapshot) => {
            workbenchSnapshotState = snapshot;
          },
        ),
      );
    },
    bindSession(health) {
      if (disposed) return;
      clearSession();
      if (health === undefined) return;
      sessionHealth = health;
      const generation = sessionGeneration;
      unsubscribeSession = health.subscribe(
        admit(
          generation,
          () => sessionGeneration,
          (snapshot) => {
            sessionSnapshotState = snapshot;
          },
        ),
      );
    },
    recover(scope) {
      if (sessionHealth !== undefined && hasRecovery(sessionSnapshotState, scope)) {
        return sessionHealth.recover(scope);
      }
      if (workbenchHealth !== undefined && hasRecovery(workbenchSnapshotState, scope)) {
        return workbenchHealth.recover(scope);
      }
      return Promise.reject(new Error(`No active ${scope} recovery`));
    },
    dispose() {
      if (disposed) return;
      clearSession();
      clearWorkbench();
      disposed = true;
    },
  };
}

export function PlaygroundHealthBanner(props: {
  readonly boot: Accessor<PlaygroundBootLifecycle>;
  readonly issues: Accessor<readonly WorkbenchHealthIssue[]>;
  readonly onRetry: () => void;
  readonly onRecover: (scope: 'scm' | 'preview' | 'persistence') => void;
  readonly onReload: () => void;
}) {
  return (
    <>
      <Show when={props.boot().kind === 'opening'}>
        <output class="rf-banner rf-banner--health" data-workbench-health="opening">
          <span class="rf-banner__msg">Opening Workbench…</span>
        </output>
      </Show>
      <Show when={props.boot().kind === 'boot-failed'}>
        <PlaygroundBootFailureBanner
          summary={
            (props.boot() as Extract<PlaygroundBootLifecycle, { kind: 'boot-failed' }>).summary
          }
          onRetry={props.onRetry}
          onReload={props.onReload}
        />
      </Show>
      <For each={props.issues()}>
        {(issue) => (
          <div
            class="rf-banner rf-banner--health"
            role={issue.kind === 'degraded' ? 'status' : 'alert'}
            data-workbench-health={issue.kind}
            data-health-scope={issue.scope}
          >
            <span class="rf-banner__msg">{issue.summary}</span>
            <Show
              when={issue.recovery !== 'reload'}
              fallback={
                <button
                  type="button"
                  class="rf-btn rf-btn--warn-ghost"
                  data-action="reload-workbench"
                  onClick={() => props.onReload()}
                >
                  Reload
                </button>
              }
            >
              <button
                type="button"
                class="rf-btn rf-btn--warn-ghost"
                data-action={`recover-${issue.recovery}`}
                onClick={() => props.onRecover(issue.recovery as 'scm' | 'preview' | 'persistence')}
              >
                Retry {issue.scope}
              </button>
            </Show>
          </div>
        )}
      </For>
    </>
  );
}

function PlaygroundBootFailureBanner(props: {
  readonly summary: string;
  readonly onRetry: () => void;
  readonly onReload: () => void;
}) {
  return (
    <div class="rf-banner rf-banner--health" role="alert" data-workbench-health="boot-failed">
      <span class="rf-banner__msg">Workbench failed to open — {props.summary}</span>
      <button
        type="button"
        class="rf-btn rf-btn--warn-ghost"
        data-action="retry-workbench"
        onClick={() => props.onRetry()}
      >
        Retry
      </button>
      <button
        type="button"
        class="rf-btn rf-btn--ghost"
        data-action="reload-workbench"
        onClick={() => props.onReload()}
      >
        Reload
      </button>
    </div>
  );
}
