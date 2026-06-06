/**
 * Activity bar (ADR-0075) — the lime "alive spine". A 46px rail that toggles
 * the sidebar between the Explorer and Presets views; clicking the active view
 * collapses the sidebar (VSCode ergonomics). Distinctly rifty: a glowing lime
 * indicator on the active item rather than VSCode's flat blue rail.
 */
import type { SidebarView } from '../glue/layout-store.ts';

export function ActivityBar(props: {
  view: SidebarView;
  collapsed: boolean;
  onSelect(view: SidebarView): void;
}) {
  const isActive = (v: SidebarView): boolean => props.view === v && !props.collapsed;
  return (
    <nav class="rf-activity" aria-label="Activity bar">
      <button
        type="button"
        class="rf-activity__btn"
        data-active={isActive('explorer')}
        aria-pressed={isActive('explorer')}
        title="Explorer"
        aria-label="Explorer"
        onClick={() => props.onSelect('explorer')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path
            d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.6 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="rf-activity__btn"
        data-active={isActive('presets')}
        aria-pressed={isActive('presets')}
        data-action="view-templates"
        title="Templates"
        aria-label="Templates"
        onClick={() => props.onSelect('presets')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path
            d="M12 3.5l1.9 4.4 4.6.4-3.5 3 1.1 4.5L12 13.9 7.4 15.8l1.1-4.5-3.5-3 4.6-.4z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <span class="rf-activity__spacer" />

      <a
        class="rf-activity__btn rf-activity__link"
        href="https://github.com/vanilla-wave/rifty"
        target="_blank"
        rel="noopener noreferrer"
        title="rifty on GitHub"
        aria-label="rifty on GitHub"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.9.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.86l-.01 2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
        </svg>
        <span class="rf-sr-only">rifty on GitHub</span>
      </a>
    </nav>
  );
}
