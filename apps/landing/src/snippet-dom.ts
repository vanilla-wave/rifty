import type { SnippetLine } from './public-snippets';

/** Render token lines as `<div>` rows; an empty line keeps its height. */
export function renderSnippet(lines: readonly SnippetLine[], lineClass: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = lineClass;
    if (line.length === 0) {
      row.textContent = ' ';
    } else {
      for (const [text, cls] of line) {
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = text;
        row.append(span);
      }
    }
    fragment.append(row);
  }
  return fragment;
}
