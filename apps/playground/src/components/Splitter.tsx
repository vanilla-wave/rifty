/**
 * Hand-rolled, zero-dep resize handle for the VSCode shell (ADR-0075).
 *
 * A thin `role="separator"` bar that drives ONE size value (px). The parent
 * owns the value (a Solid signal) and feeds it into a CSS grid-track variable,
 * so dragging reflows the grid and Monaco (`automaticLayout`) / xterm
 * (`ResizeObserver`) refit themselves — no per-component resize plumbing.
 *
 * `dir` lets a handle sit on either side of its panel and still grow it
 * intuitively: +1 when moving the pointer toward larger screen coords grows the
 * panel (e.g. sidebar handle on its right edge), -1 when it's on the far side
 * (console handle on its top edge, preview handle on its left edge). Keyboard
 * nudges mirror the drag (screen-axis sign × step × dir).
 *
 * While dragging, `document.body` gets `.rf-resizing` which kills text
 * selection AND sets `pointer-events:none` on the preview `<iframe>` — without
 * that the iframe swallows `pointermove` and the drag "sticks".
 */
import { nextSizeFromDelta } from '../glue/splitter-size.ts';

export interface SplitterProps {
  /** `vertical` = a vertical bar dragged along X to size a column width;
   *  `horizontal` = a horizontal bar dragged along Y to size a row height. */
  readonly orientation: 'vertical' | 'horizontal';
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  /** +1 if larger screen-coord = larger panel; -1 if the handle is on the far side. */
  readonly dir?: 1 | -1;
  readonly ariaLabel: string;
  /** Live size during drag / keyboard nudge. */
  onInput(px: number): void;
  /** Final size on pointer-up (persist here). */
  onCommit?(px: number): void;
  /** Double-click — reset to `defaultValue`. */
  onReset?(): void;
}

export function Splitter(props: SplitterProps) {
  const dir = (): 1 | -1 => props.dir ?? 1;

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startValue = props.value;
    const startPos = props.orientation === 'vertical' ? e.clientX : e.clientY;
    document.body.classList.add('rf-resizing');

    const move = (ev: PointerEvent): void => {
      const cur = props.orientation === 'vertical' ? ev.clientX : ev.clientY;
      const delta = (cur - startPos) * dir();
      props.onInput(nextSizeFromDelta(startValue, delta, props.min, props.max));
    };
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('rf-resizing');
      props.onCommit?.(props.value);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function onKeyDown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 48 : 16;
    let screenSign = 0;
    if (props.orientation === 'vertical') {
      if (e.key === 'ArrowRight') screenSign = 1;
      else if (e.key === 'ArrowLeft') screenSign = -1;
    } else {
      if (e.key === 'ArrowDown') screenSign = 1;
      else if (e.key === 'ArrowUp') screenSign = -1;
    }
    if (screenSign !== 0) {
      e.preventDefault();
      const next = nextSizeFromDelta(props.value, screenSign * step * dir(), props.min, props.max);
      props.onInput(next);
      props.onCommit?.(next);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      props.onInput(props.min);
      props.onCommit?.(props.min);
    } else if (e.key === 'End') {
      e.preventDefault();
      props.onInput(props.max);
      props.onCommit?.(props.max);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onReset?.();
    }
  }

  return (
    <div
      class="rf-splitter"
      data-orientation={props.orientation}
      role="separator"
      tabindex="0"
      aria-orientation={props.orientation === 'vertical' ? 'vertical' : 'horizontal'}
      aria-label={props.ariaLabel}
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      onPointerDown={onPointerDown}
      onDblClick={() => props.onReset?.()}
      onKeyDown={onKeyDown}
    >
      <span class="rf-splitter__grip" aria-hidden="true" />
    </div>
  );
}
