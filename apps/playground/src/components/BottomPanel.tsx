/**
 * Bottom console panel (ADR-0075) — the relocated terminal, now spanning the
 * editor-area width at the bottom of the shell (req #1: console to the bottom).
 *
 * The `TerminalPanel` (xterm) is ALWAYS mounted: collapsing only hides the body
 * via CSS, so the single `attachWriter` wiring stays valid and stdout keeps
 * flowing while collapsed. xterm's own `ResizeObserver` refits on expand.
 */
import { TerminalPanel } from './TerminalPanel.tsx';

export function BottomPanel(props: {
  sub: string;
  collapsed: boolean;
  onToggleCollapse(): void;
  attach(write: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  onLine(line: string): void | Promise<void>;
}) {
  return (
    <section class="rf-console" data-collapsed={props.collapsed} data-testid="console">
      <div class="rf-console__head">
        <button
          type="button"
          class="rf-console__toggle"
          aria-expanded={!props.collapsed}
          aria-label={props.collapsed ? 'Expand console' : 'Collapse console'}
          onClick={() => props.onToggleCollapse()}
        >
          <span class="rf-console__chevron" data-collapsed={props.collapsed} aria-hidden="true">
            ⌄
          </span>
          <span class="rf-eyebrow">Console</span>
        </button>
        <span class="rf-console__sub">{props.sub}</span>
      </div>
      <div class="rf-console__body">
        <TerminalPanel attach={props.attach} onLine={props.onLine} />
      </div>
    </section>
  );
}
