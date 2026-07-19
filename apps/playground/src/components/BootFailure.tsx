import { For, Show, createSignal } from 'solid-js';
import { Icon } from './icons.tsx';

export interface BootFailureProps {
  readonly error: unknown;
  /** Re-runs the finite page-entry transaction in place; disabled while one runs. */
  onRetry(): void;
  onReload(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Standalone failure notice for a fatal page-entry outcome (ADR-0293 decision 9). */
export function BootFailure(props: BootFailureProps) {
  const causes = props.error instanceof AggregateError ? props.error.errors.map(messageOf) : [];
  const [retrying, setRetrying] = createSignal(false);
  return (
    <main
      class="rf-workspace-occupied rf-workspace-occupied--failure"
      data-testid="boot-failure"
      data-workbench-health="boot-failed"
      role="alert"
      aria-labelledby="rf-boot-failure-title"
      aria-describedby="rf-boot-failure-body"
    >
      <div class="rf-workspace-occupied__frame">
        <header class="rf-workspace-occupied__header">
          <span class="rf-brand">
            <span class="rf-brand__mark" aria-hidden="true" />
            <strong class="rf-wordmark">rifty</strong>
          </span>
          <span class="rf-workspace-occupied__status">
            <span class="rf-workspace-occupied__status-dot" aria-hidden="true" />
            Boot failed
          </span>
        </header>

        <section class="rf-workspace-occupied__panel">
          <span class="rf-workspace-occupied__icon" aria-hidden="true">
            <Icon name="triangle-exclamation-fill" size={27} />
          </span>
          <div class="rf-workspace-occupied__content">
            <span class="rf-workspace-occupied__eyebrow">Startup error</span>
            <h1 id="rf-boot-failure-title">Playground failed to start</h1>
            <p id="rf-boot-failure-body">
              Nothing was opened. Retry the same start, or reload the page; the causes below are
              also in the browser console.
            </p>
            <div class="rf-boot-failure__cause">
              <div>{messageOf(props.error)}</div>
              <Show when={causes.length > 0}>
                <ul>
                  <For each={causes}>{(cause) => <li>{cause}</li>}</For>
                </ul>
              </Show>
            </div>
          </div>
          <div class="rf-boot-failure__actions">
            <button
              type="button"
              class="rf-btn rf-btn--lime"
              data-action="retry-workbench"
              disabled={retrying()}
              onClick={() => {
                if (retrying()) return;
                setRetrying(true);
                props.onRetry();
              }}
            >
              <Icon name="rotate-ccw" size={15} />
              Retry
            </button>
            <button
              type="button"
              class="rf-btn rf-btn--ghost"
              data-action="reload-workspace"
              onClick={() => props.onReload()}
            >
              Reload
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
