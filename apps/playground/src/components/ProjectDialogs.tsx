/**
 * The five project dialogs (design Dialogs table; ADR-0165 §7). Centered 400px
 * card radius 12 padding 22, veil rgba(8,9,12,0.55). One <Show> per dialog.kind.
 * Save (lime circle-check), Rename (neutral pencil), Reset (amber #FFBE5C, can't-
 * be-undone), Delete (red #FF6B6B, undo-able), Switch (amber triangle, dest =
 * project name | "a new <Starter> scratch", three actions).
 */
import { Show } from 'solid-js';
import type { Dialog } from '../glue/page-store.ts';
import { Icon } from './icons.tsx';

export function ProjectDialogs(props: {
  dialog: Dialog;
  saveName: string;
  renameName: string;
  targetName: string;
  starterLabel: string;
  switchDest: string;
  onSaveName(v: string): void;
  onRenameName(v: string): void;
  onCancel(): void;
  onConfirmSave(): void;
  onConfirmRename(): void;
  onConfirmReset(): void;
  onConfirmDelete(): void;
  onConfirmResetSandbox(): void;
  onSwitchSaveThen(): void;
  onSwitchDiscardThen(): void;
}) {
  return (
    <Show when={props.dialog} keyed>
      {(dialog) => {
        const is = (k: NonNullable<Dialog>['kind']): boolean => dialog.kind === k;
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop close — the veil is not an interactive control; its real actions are the keyboard-accessible inner buttons.
          <div class="rf-dialog__veil" onClick={() => props.onCancel()}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: card surface only stops the click bubbling into the veil; its real actions are the keyboard-accessible <button>s within. */}
            <div
              class="rf-dialog"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <Show when={is('save')}>
                <div class="rf-dialog__icon" data-tone="lime">
                  <Icon name="circle-check" size={20} />
                </div>
                <h2 class="rf-dialog__title">Save as project</h2>
                <p class="rf-dialog__body">
                  Your scratch becomes a named project. It autosaves from here on — no more Save
                  button.
                </p>
                <input
                  class="rf-dialog__input"
                  value={props.saveName}
                  onInput={(e) => props.onSaveName(e.currentTarget.value)}
                />
                <div class="rf-dialog__actions">
                  <button
                    type="button"
                    class="rf-btn rf-btn--ghost"
                    onClick={() => props.onCancel()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rf-btn rf-btn--lime"
                    onClick={() => props.onConfirmSave()}
                  >
                    Save project
                  </button>
                </div>
              </Show>
              <Show when={is('rename')}>
                <div class="rf-dialog__icon">
                  <Icon name="pencil-to-square" size={20} />
                </div>
                <h2 class="rf-dialog__title">Rename project</h2>
                <input
                  class="rf-dialog__input"
                  value={props.renameName}
                  onInput={(e) => props.onRenameName(e.currentTarget.value)}
                />
                <div class="rf-dialog__actions">
                  <button
                    type="button"
                    class="rf-btn rf-btn--ghost"
                    onClick={() => props.onCancel()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rf-btn rf-btn--lime"
                    onClick={() => props.onConfirmRename()}
                  >
                    Rename
                  </button>
                </div>
              </Show>
              <Show when={is('reset')}>
                <div class="rf-dialog__icon" data-tone="amber">
                  <Icon name="arrow-rotate-left" size={20} />
                </div>
                <h2 class="rf-dialog__title">Reset to starter</h2>
                <p class="rf-dialog__body">
                  This discards every edit in <strong>{props.targetName}</strong> and restores the
                  clean {props.starterLabel} starter files. This can't be undone.
                </p>
                <div class="rf-dialog__actions">
                  <button
                    type="button"
                    class="rf-btn rf-btn--ghost"
                    onClick={() => props.onCancel()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rf-btn rf-btn--amber"
                    onClick={() => props.onConfirmReset()}
                  >
                    Reset files
                  </button>
                </div>
              </Show>
              <Show when={is('delete')}>
                <div class="rf-dialog__icon" data-tone="danger">
                  <Icon name="trash-bin" size={20} />
                </div>
                <h2 class="rf-dialog__title">Delete project</h2>
                <p class="rf-dialog__body">
                  Delete <strong>{props.targetName}</strong> and its files. You can undo this right
                  after.
                </p>
                <div class="rf-dialog__actions">
                  <button
                    type="button"
                    class="rf-btn rf-btn--ghost"
                    onClick={() => props.onCancel()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rf-btn rf-btn--danger"
                    onClick={() => props.onConfirmDelete()}
                  >
                    Delete
                  </button>
                </div>
              </Show>
              <Show when={is('switch')}>
                <div class="rf-dialog__icon" data-tone="amber">
                  <Icon name="triangle-exclamation-fill" size={20} />
                </div>
                <h2 class="rf-dialog__title">Discard unsaved scratch?</h2>
                <p class="rf-dialog__body">
                  Opening <strong>{props.switchDest}</strong> restarts the dev server and discards
                  your unsaved draft. Save it first to keep it.
                </p>
                <div class="rf-dialog__actions rf-dialog__actions--stack">
                  <button
                    type="button"
                    class="rf-btn rf-btn--lime rf-btn--block"
                    onClick={() => props.onSwitchSaveThen()}
                  >
                    Save scratch, then continue
                  </button>
                  <div class="rf-dialog__actions">
                    <button
                      type="button"
                      class="rf-btn rf-btn--ghost"
                      onClick={() => props.onCancel()}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="rf-btn rf-btn--danger-outline"
                      onClick={() => props.onSwitchDiscardThen()}
                    >
                      Discard & continue
                    </button>
                  </div>
                </div>
              </Show>
              <Show when={is('reset-sandbox')}>
                <div class="rf-dialog__icon" data-tone="danger">
                  <Icon name="trash-bin" size={20} />
                </div>
                <h2 class="rf-dialog__title">Reset browser sandbox?</h2>
                <p class="rf-dialog__body">
                  This deletes <strong>every saved project, scratch, and installed package</strong>{' '}
                  from this browser (OPFS, storage, caches, service worker) and reloads. This can't
                  be undone.
                </p>
                <div class="rf-dialog__actions">
                  <button
                    type="button"
                    class="rf-btn rf-btn--ghost"
                    onClick={() => props.onCancel()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rf-btn rf-btn--danger"
                    data-action="confirm-reset-browser-sandbox"
                    onClick={() => props.onConfirmResetSandbox()}
                  >
                    Reset sandbox
                  </button>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
