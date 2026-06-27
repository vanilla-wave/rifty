/**
 * Launcher Projects tab (design §2a; ADR-0165). Scratch banner (Starter scratch +
 * dirty dot 7x7 #FFBE5C + ACTIVE badge + Save-as-project lime), SAVED PROJECTS
 * label, 2-col project cards (glyph tile / name / ACTIVE / ellipsis menu / meta
 * =Starter·:port / clock+editedAt / storage OPFS-green or memory-#FFCE84). Row
 * menu: Switch / Rename... / Reset... / Export-archive DISABLED+soon (M13, §11) /
 * Delete (red). New-from-starter dashed tile -> Starters tab.
 */
import { For, Show } from 'solid-js';
import { scratchDisplayName } from '../glue/project-display-name.ts';
import type { ActiveId, Project, Scratch } from '../glue/project-index.ts';
import { Icon } from './icons.tsx';

export type RowAction = 'switch' | 'rename' | 'reset' | 'delete';
type Glyph = { text: string; color: string; label: string; port: number };

export function ProjectsTab(props: {
  projects: readonly Project[];
  scratch: Scratch | null;
  activeId: ActiveId;
  storage: 'opfs' | 'memory';
  menuFor: string | null;
  glyphFor(starter: string): Glyph;
  onPick(): void;
  onSwitch(id: ActiveId): void;
  onSave(): void;
  onMenu(id: string): void;
  onMenuAction(id: string, action: RowAction): void;
  onNewFromStarter(): void;
  onResetSandbox(): void;
}) {
  const scratchActive = (): boolean => props.activeId === 'scratch';
  const storeLabel = (): string => (props.storage === 'opfs' ? 'OPFS' : 'memory');
  const storeColor = (): string => (props.storage === 'opfs' ? '#5BD79B' : '#FFCE84');

  return (
    <div class="rf-projects">
      <Show when={props.scratch} keyed>
        {(sc) => {
          const g = props.glyphFor(sc.starter);
          return (
            <div class="rf-scratch" data-active={scratchActive()}>
              <span class="rf-scratch__tile" style={{ color: g.color }} aria-hidden="true">
                {g.text}
              </span>
              <div class="rf-scratch__body">
                <div class="rf-scratch__title">
                  {scratchDisplayName(g.label)}
                  <Show when={sc.dirty}>
                    <span class="rf-scratch__dot" aria-hidden="true" />
                  </Show>
                  <Show when={scratchActive()}>
                    <span class="rf-badge rf-badge--active">ACTIVE</span>
                  </Show>
                </div>
                <div class="rf-scratch__sub">
                  from {g.label} starter ·{' '}
                  {sc.dirty ? 'edited just now · not yet saved' : 'no edits yet'}
                </div>
              </div>
              <Show when={!scratchActive()}>
                <button
                  type="button"
                  class="rf-btn rf-btn--outline"
                  onClick={() => props.onSwitch('scratch')}
                >
                  Switch to
                </button>
              </Show>
              <button
                type="button"
                class="rf-btn rf-btn--lime"
                data-action="save-scratch"
                onClick={() => props.onSave()}
              >
                <Icon name="circle-check" size={14} /> Save as project
              </button>
            </div>
          );
        }}
      </Show>

      <div class="rf-projects__toolbar">
        <button
          type="button"
          class="rf-btn rf-btn--danger-outline"
          data-action="reset-browser-sandbox"
          title="Delete browser sandbox state and reload"
          onClick={() => props.onResetSandbox()}
        >
          <Icon name="trash-bin" size={13} /> Reset sandbox
        </button>
      </div>

      <div class="rf-projects__label">SAVED PROJECTS · {props.projects.length}</div>

      <div class="rf-projects__grid">
        <For each={props.projects}>
          {(p) => {
            const g = props.glyphFor(p.starter);
            const active = (): boolean => props.activeId === p.id;
            return (
              // a11y: the card surface is clickable yet nests its own <button>s (ellipsis menu + row-menu items), so a real <button> would be invalid; role=button + tabindex + keydown is the accessible equivalent (useSemanticElements off for this file, biome.json override — same as FileExplorer/Splitter).
              <div
                class="rf-pcard"
                role="button"
                tabIndex={0}
                data-project={p.id}
                data-active={active()}
                onClick={() => props.onSwitch(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onSwitch(p.id);
                  }
                }}
              >
                <div class="rf-pcard__row1">
                  <span class="rf-pcard__tile" style={{ color: g.color }} aria-hidden="true">
                    {g.text}
                  </span>
                  <span class="rf-pcard__name">{p.name}</span>
                  <Show when={active()}>
                    <span class="rf-badge rf-badge--active">ACTIVE</span>
                  </Show>
                  <button
                    type="button"
                    class="rf-pcard__menu"
                    aria-label="Project actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onMenu(p.id);
                    }}
                  >
                    <Icon name="ellipsis" size={16} />
                  </button>
                </div>
                <div class="rf-pcard__meta">
                  ={g.label} · :{g.port}
                </div>
                <div class="rf-pcard__foot">
                  <span class="rf-pcard__edited">
                    <Icon name="clock" size={12} /> {p.editedAt}
                  </span>
                  <span class="rf-pcard__store" style={{ color: storeColor() }}>
                    <Icon name="database" size={12} /> {storeLabel()}
                  </span>
                </div>
                <Show when={props.menuFor === p.id}>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: container only stops bubbling into the card's switch handler; its real actions are the <button> rows below (each keyboard-accessible). */}
                  <div class="rf-rowmenu" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      class="rf-rowmenu__item"
                      onClick={() => props.onMenuAction(p.id, 'switch')}
                    >
                      <Icon name="play" size={13} /> Switch to project
                    </button>
                    <button
                      type="button"
                      class="rf-rowmenu__item"
                      onClick={() => props.onMenuAction(p.id, 'rename')}
                    >
                      <Icon name="pencil-to-square" size={13} /> Rename…
                    </button>
                    <button
                      type="button"
                      class="rf-rowmenu__item"
                      onClick={() => props.onMenuAction(p.id, 'reset')}
                    >
                      <Icon name="arrow-rotate-left" size={13} /> Reset to starter…
                    </button>
                    {/* M13 (§11): Export-archive logic stays live in the owner; only this SURFACE is disabled with a soon pill. */}
                    <span class="rf-rowmenu__item" data-disabled="true" aria-disabled="true">
                      <Icon name="file-arrow-down" size={13} /> Export archive
                      <span class="rf-pill rf-pill--soon">soon</span>
                    </span>
                    <div class="rf-rowmenu__divider" />
                    <button
                      type="button"
                      class="rf-rowmenu__item rf-rowmenu__item--danger"
                      onClick={() => props.onMenuAction(p.id, 'delete')}
                    >
                      <Icon name="trash-bin" size={13} /> Delete
                    </button>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
        <button
          type="button"
          class="rf-pcard rf-pcard--new"
          onClick={() => props.onNewFromStarter()}
        >
          <Icon name="plus" size={16} /> New from starter
        </button>
      </div>
    </div>
  );
}
