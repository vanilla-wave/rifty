/**
 * Editor tab strip (ADR-0075). Presentational: the permanent program tab
 * (◆, non-closable) first, then file tabs with a dirty dot + close affordance.
 * State lives in {@link EditorHost.tsx}; this only renders + emits intent.
 */
import { For } from 'solid-js';
import { type EditorTab, PROGRAM_TAB_ID } from '../glue/editor-tabs.ts';

export function EditorTabs(props: {
  tabs: EditorTab[];
  activeId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
}) {
  return (
    <div class="rf-tabs" role="tablist" aria-label="Open editors">
      <For each={props.tabs}>
        {(tab) => (
          <div
            class="rf-tab"
            role="tab"
            tabIndex={0}
            data-tab={tab.id === PROGRAM_TAB_ID ? 'program' : 'file'}
            data-active={props.activeId === tab.id}
            aria-selected={props.activeId === tab.id}
            onClick={() => props.onSelect(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onSelect(tab.id);
              }
            }}
            onAuxClick={(e) => {
              // Middle-click closes file tabs (VSCode parity).
              if (e.button === 1 && tab.kind === 'file') {
                e.preventDefault();
                props.onClose(tab.id);
              }
            }}
          >
            {tab.kind === 'program' ? (
              <span class="rf-tab__mark" aria-hidden="true" />
            ) : (
              <span class="rf-tab__dot" data-dirty={tab.dirty} aria-hidden="true" />
            )}
            <span class="rf-tab__label">{tab.title}</span>
            {tab.kind === 'file' && (
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
            )}
          </div>
        )}
      </For>
    </div>
  );
}
