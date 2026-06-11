/**
 * Global command palette (⌘K / Ctrl-K) — the top-bar command bar's action.
 * Sections: templates, workspace files, shell actions. Pure UI: items (with
 * their `run`) are built by the App when the palette opens.
 *
 * Modal behavior: <dialog> semantics, Tab trapped inside the panel, Escape
 * handled at document level (so it works wherever focus is), and focus is
 * restored to the pre-open element on close.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Icon, type IconName } from './icons.tsx';

export interface PaletteItem {
  readonly id: string;
  /** Section header the item is grouped under (insertion order). */
  readonly section: string;
  readonly label: string;
  /** Dim mono hint on the right (e.g. a path or shortcut). */
  readonly hint?: string;
  readonly icon?: IconName;
  run(): void;
}

export function CommandPalette(props: {
  open: boolean;
  items: readonly PaletteItem[];
  onClose(): void;
}) {
  const [query, setQuery] = createSignal('');
  const [cursor, setCursor] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;
  let panelEl: HTMLDialogElement | undefined;
  let listEl: HTMLDivElement | undefined;
  let restoreFocusTo: HTMLElement | null = null;

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.items;
    return props.items.filter(
      (item) => item.label.toLowerCase().includes(q) || (item.hint ?? '').toLowerCase().includes(q),
    );
  });

  const sections = createMemo(() => {
    const order: string[] = [];
    for (const item of filtered()) {
      if (!order.includes(item.section)) order.push(item.section);
    }
    return order;
  });

  createEffect(() => {
    if (props.open) {
      restoreFocusTo =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setCursor(0);
      queueMicrotask(() => inputEl?.focus());
      // Document-level Escape: still closes after focus wanders (e.g. Tab).
      const onDocKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onClose();
        }
      };
      document.addEventListener('keydown', onDocKey, true);
      onCleanup(() => {
        document.removeEventListener('keydown', onDocKey, true);
        restoreFocusTo?.focus();
        restoreFocusTo = null;
      });
    }
  });

  // Reset the cursor when filtering shrinks the list under it.
  createEffect(() => {
    if (cursor() >= filtered().length) setCursor(0);
  });

  // Keep the highlighted row visible while arrowing through a long list.
  createEffect(() => {
    cursor();
    queueMicrotask(() => {
      listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  });

  function runAt(index: number): void {
    const item = filtered()[index];
    if (!item) return;
    props.onClose();
    item.run();
  }

  function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !panelEl) return;
    const focusables = Array.from(
      panelEl.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])'),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    trapTab(e);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(filtered().length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(cursor());
    }
  }

  const flatIndex = (item: PaletteItem): number => filtered().indexOf(item);

  return (
    <Show when={props.open}>
      <div
        class="rf-palette"
        data-testid="command-palette"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onKeyDown={onKeyDown}
      >
        <dialog ref={panelEl} open class="rf-palette__panel" aria-label="Command palette">
          <div class="rf-palette__inputrow">
            <Icon name="search" size={14} />
            <input
              ref={inputEl}
              class="rf-palette__input"
              type="text"
              placeholder="Search files, templates, commands…"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setCursor(0);
              }}
            />
            <span class="rf-kbd">esc</span>
          </div>
          <div ref={listEl} class="rf-palette__list">
            <For each={sections()}>
              {(section) => (
                <>
                  <div class="rf-palette__section">{section}</div>
                  <For each={filtered().filter((item) => item.section === section)}>
                    {(item) => (
                      <button
                        type="button"
                        class="rf-palette__item"
                        data-active={flatIndex(item) === cursor()}
                        onMouseEnter={() => setCursor(flatIndex(item))}
                        onClick={() => runAt(flatIndex(item))}
                      >
                        <span class="rf-palette__item-ico" aria-hidden="true">
                          <Icon name={item.icon ?? 'terminal'} size={14} />
                        </span>
                        <span class="rf-palette__item-label">{item.label}</span>
                        <Show when={item.hint}>
                          <span class="rf-palette__item-hint">{item.hint}</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <p class="rf-palette__empty">Nothing matches “{query()}”.</p>
            </Show>
          </div>
        </dialog>
      </div>
    </Show>
  );
}
