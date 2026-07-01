/**
 * Launcher modal (design §2; ADR-0165 §9). 1040x624 card bg #1D1F26 radius 12,
 * veil rgba(8,9,12,0.62). Segmented Starters | Projects (active tint
 * rgba(199,240,90,0.14) / #E4F8B8); Projects shows a count pill = projects +
 * (scratch?1:0). Background click closes any open row menu (onMenu(null)).
 *
 * Cross-Phase Reconciliation A: the canonical StartersTab renders straight from
 * `Preset[]` (gallery-display fields live on Preset, not a deep-copied Starter),
 * so the Launcher carries `presets` and feeds the tab directly; `StarterGroup`
 * is the lone Starter-layer type it needs (from glue/starter.ts).
 */
import { Show } from 'solid-js';
import type { ActiveId, Project, Scratch } from '../glue/project-index.ts';
import type { StarterGroup } from '../glue/starter.ts';
import type { Preset } from '../presets.ts';
import { ProjectsTab, type RowAction } from './ProjectsTab.tsx';
import { StartersTab } from './StartersTab.tsx';
import { Icon } from './icons.tsx';

export function Launcher(props: {
  open: boolean;
  tab: 'starters' | 'projects';
  presets: readonly Preset[];
  projects: readonly Project[];
  scratch: Scratch | null;
  activeId: ActiveId;
  storage: 'opfs' | 'memory';
  menuFor: string | null;
  q: string;
  cat: 'all' | StarterGroup;
  glyphFor(starter: string): { text: string; color: string; label: string; port: number };
  onTab(tab: 'starters' | 'projects'): void;
  onClose(): void;
  onSearch(q: string): void;
  onCat(cat: 'all' | StarterGroup): void;
  onPickStarter(id: string): void;
  onSwitch(id: ActiveId): void;
  onSave(): void;
  onMenu(id: string | null): void;
  onMenuAction(id: string, action: RowAction): void;
  onResetSandbox(): void;
}) {
  const count = (): number => props.projects.length + (props.scratch ? 1 : 0);
  const placeholder = (): string =>
    props.tab === 'starters' ? 'Search starters' : 'Search projects';
  return (
    <Show when={props.open}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop close — the veil is not an interactive control. Keyboard close is the header Close button (a real <button>) + Escape (handled window-level in App, closes dialog → launcher). */}
      <div class="rf-launcher__veil" onClick={() => props.onClose()}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: card surface only dismisses an open row menu + stops the click bubbling into the veil; its real actions are the keyboard-accessible <button>s within. */}
        <div
          class="rf-launcher"
          data-testid="launcher"
          role="dialog"
          aria-label="Project launcher"
          onClick={(e) => {
            if (props.menuFor) props.onMenu(null);
            e.stopPropagation();
          }}
        >
          <header class="rf-launcher__head">
            <span class="rf-launcher__mark" aria-hidden="true" />
            <div class="rf-launcher__tabs">
              <button
                type="button"
                class="rf-launcher__tab"
                data-active={props.tab === 'starters'}
                onClick={() => props.onTab('starters')}
              >
                Starters
              </button>
              <button
                type="button"
                class="rf-launcher__tab"
                data-active={props.tab === 'projects'}
                onClick={() => props.onTab('projects')}
              >
                Projects<span class="rf-launcher__count">{count()}</span>
              </button>
            </div>
            <input
              class="rf-launcher__search"
              type="search"
              placeholder={placeholder()}
              value={props.q}
              onInput={(e) => props.onSearch(e.currentTarget.value)}
            />
            <button
              type="button"
              class="rf-launcher__close"
              aria-label="Close"
              onClick={() => props.onClose()}
            >
              <Icon name="x" size={14} />
            </button>
          </header>
          <Show
            when={props.tab === 'starters'}
            fallback={
              <ProjectsTab
                projects={props.projects}
                scratch={props.scratch}
                activeId={props.activeId}
                storage={props.storage}
                menuFor={props.menuFor}
                glyphFor={props.glyphFor}
                onPick={() => props.onTab('starters')}
                onSwitch={props.onSwitch}
                onSave={props.onSave}
                onMenu={props.onMenu}
                onMenuAction={props.onMenuAction}
                onNewFromStarter={() => props.onTab('starters')}
                onResetSandbox={props.onResetSandbox}
              />
            }
          >
            <StartersTab
              presets={props.presets}
              q={props.q}
              cat={props.cat}
              onPick={props.onPickStarter}
              onSearch={props.onSearch}
              onCat={props.onCat}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
}
