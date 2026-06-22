/**
 * Problems panel (ADR-0166 P1.9c) — the aggregated diagnostics view in the bottom
 * panel, the second tab beside the terminal. Lists every rifty-TS diagnostic
 * across open files (file · line:col · severity · message); a click jumps the
 * editor to the exact span. Fed the aggregated `path → Diagnostic[]` map App owns
 * (the same diagnostics that drive the editor squiggles), so it never re-queries.
 *
 * Read-only; no Monaco import (the diagnostics arrive as plain LSP shapes). Solid
 * idioms mirror BottomPanel (`createMemo`/`For`/`Show`). Severity → a glyph +
 * `data-severity` so CSS colours it without an icon-set addition.
 */

import { type Diagnostic, DiagnosticSeverity } from '@riftydev/ts-language-service';
import { basename } from '@riftydev/vfs';
import { For, Show, createMemo } from 'solid-js';

/** A flattened diagnostic row (carries its source path for the jump). */
export interface ProblemRow {
  readonly path: string;
  readonly diagnostic: Diagnostic;
}

/** Flatten the per-file map to a stable, sorted row list (file, then position). */
export function flattenProblems(
  diagnostics: ReadonlyMap<string, readonly Diagnostic[]>,
): ProblemRow[] {
  const rows: ProblemRow[] = [];
  for (const [path, diags] of diagnostics) {
    for (const diagnostic of diags) rows.push({ path, diagnostic });
  }
  rows.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const al = a.diagnostic.range.start.line;
    const bl = b.diagnostic.range.start.line;
    if (al !== bl) return al - bl;
    return a.diagnostic.range.start.character - b.diagnostic.range.start.character;
  });
  return rows;
}

/** Severity → a compact glyph + label (no icon-set dependency). */
function severityGlyph(severity: DiagnosticSeverity): { glyph: string; label: string } {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return { glyph: '✕', label: 'Error' };
    case DiagnosticSeverity.Warning:
      return { glyph: '⚠', label: 'Warning' };
    case DiagnosticSeverity.Information:
      return { glyph: 'ℹ', label: 'Information' };
    case DiagnosticSeverity.Hint:
      return { glyph: '◌', label: 'Hint' };
    default:
      return { glyph: '✕', label: 'Error' };
  }
}

export function ProblemsPanel(props: {
  diagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
  /** Jump to a diagnostic: `line`/`column` are 1-based Monaco coordinates. */
  onOpen(path: string, line: number, column: number): void;
}) {
  const rows = createMemo(() => flattenProblems(props.diagnostics));

  return (
    <div class="rf-problems" data-testid="problems-panel">
      <Show
        when={rows().length > 0}
        fallback={
          <div class="rf-problems__empty" data-testid="problems-empty">
            No problems detected.
          </div>
        }
      >
        <ul class="rf-problems__list">
          <For each={rows()}>
            {(row) => {
              const sev = severityGlyph(row.diagnostic.severity);
              // LSP 0-based → 1-based for display + the editor jump.
              const line = row.diagnostic.range.start.line + 1;
              const column = row.diagnostic.range.start.character + 1;
              return (
                <li class="rf-problems__row">
                  <button
                    type="button"
                    class="rf-problems__item"
                    data-testid="problem-row"
                    data-severity={row.diagnostic.severity}
                    onClick={() => props.onOpen(row.path, line, column)}
                  >
                    <span
                      class="rf-problems__sev"
                      data-severity={row.diagnostic.severity}
                      aria-label={sev.label}
                      title={sev.label}
                    >
                      {sev.glyph}
                    </span>
                    <span class="rf-problems__msg">{row.diagnostic.message}</span>
                    <span class="rf-problems__loc">{`${basename(row.path)}:${line}:${column}`}</span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}
