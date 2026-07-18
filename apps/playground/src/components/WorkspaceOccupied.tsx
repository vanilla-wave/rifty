import { Icon } from './icons.tsx';

export interface WorkspaceOccupiedProps {
  onReload(): void;
}

/** Standalone refusal screen shown before the Playground mounts mutable UI. */
export function WorkspaceOccupied(props: WorkspaceOccupiedProps) {
  return (
    <main
      class="rf-workspace-occupied"
      data-testid="workspace-occupied"
      role="alert"
      aria-labelledby="rf-workspace-occupied-title"
      aria-describedby="rf-workspace-occupied-body"
    >
      <div class="rf-workspace-occupied__frame">
        <header class="rf-workspace-occupied__header">
          <span class="rf-brand">
            <span class="rf-brand__mark" aria-hidden="true" />
            <strong class="rf-wordmark">rifty</strong>
          </span>
          <span class="rf-workspace-occupied__status">
            <span class="rf-workspace-occupied__status-dot" aria-hidden="true" />
            Workspace protected
          </span>
        </header>

        <section class="rf-workspace-occupied__panel">
          <span class="rf-workspace-occupied__icon" aria-hidden="true">
            <Icon name="lock" size={27} />
          </span>
          <div class="rf-workspace-occupied__content">
            <span class="rf-workspace-occupied__eyebrow">Single-tab editing</span>
            <h1 id="rf-workspace-occupied-title">Workspace is open in another tab</h1>
            <p id="rf-workspace-occupied-body">
              Continue editing there. If that tab is closed, reload this page.
            </p>
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
