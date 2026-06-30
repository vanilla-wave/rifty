/**
 * Editor tab strip (ADR-0075). Presentational: editor tabs render a dirty dot +
 * close affordance; state lives in {@link EditorHost.tsx}.
 */
import { For } from 'solid-js';
import type { EditorTab } from '../glue/editor-tabs.ts';
import { Icon } from './icons.tsx';

export function EditorTabs(props: {
  tabs: EditorTab[];
  activeId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  previewUrl?: string;
  onOpenPreviewTab?(): void;
}) {
  const canOpenPreview = () => Boolean(props.previewUrl && props.onOpenPreviewTab);

  return (
    <div class="rf-tabsbar">
      <div class="rf-tabs" role="tablist" aria-label="Open editors">
        <For each={props.tabs}>
          {(tab) => (
            <div
              class="rf-tab"
              role="tab"
              tabIndex={0}
              data-tab={tab.kind}
              data-active={props.activeId === tab.id}
              data-dirty={tab.dirty}
              aria-selected={props.activeId === tab.id}
              onClick={() => props.onSelect(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onSelect(tab.id);
                }
              }}
              onAuxClick={(e) => {
                // Middle-click closes editor tabs (VSCode parity).
                if (e.button === 1) {
                  e.preventDefault();
                  props.onClose(tab.id);
                }
              }}
            >
              <span class="rf-tab__dot" data-dirty={tab.dirty} aria-hidden="true" />
              <span class="rf-tab__label">{tab.title}</span>
              <button
                type="button"
                class="rf-tab__close"
                aria-label={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                ✕
              </button>
            </div>
          )}
        </For>
      </div>
      {canOpenPreview() && (
        <div class="rf-tabs__actions">
          <button
            type="button"
            class="rf-tab-action"
            aria-label="Open preview in new tab"
            title="Open preview in new tab"
            onClick={() => props.onOpenPreviewTab?.()}
          >
            <Icon name="external-link" size={14} />
            <span>Preview</span>
          </button>
        </div>
      )}
    </div>
  );
}
