import { For, Show } from 'solid-js';
import { Icon } from './icons.tsx';

export interface BootFailureProps {
  readonly error: unknown;
  onReload(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Standalone failure notice for a fatal page-entry outcome; Reload is the only retry. */
export function BootFailure(props: BootFailureProps) {
  const causes = props.error instanceof AggregateError ? props.error.errors.map(messageOf) : [];
  return (
    <main
      class="rf-workspace-occupied rf-workspace-occupied--failure"
      data-testid="boot-failure"
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
              Nothing was opened. Reload to try again; if it keeps failing, the causes below are
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
          <button
            type="button"
            class="rf-btn rf-btn--lime rf-workspace-occupied__reload"
            data-action="reload-workspace"
            onClick={() => props.onReload()}
          >
            <Icon name="rotate-ccw" size={15} />
            Reload
          </button>
        </section>
      </div>
    </main>
  );
}
