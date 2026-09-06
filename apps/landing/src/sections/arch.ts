import { CEIL, type CeilDef } from '../ceiling';
import './arch.css';

const INTRO =
  'Everything executes in the page you opened — page, Workers, a Service Worker and the preview iframe. Network egress goes only to configured endpoints: the npm registry proxy, the opt-in eddy resolver, a git CORS proxy — plus the browser-validated fetch behind node:http/https clients. Dependencies flow top-down only — no reverse imports; the UI framework never leaks below the playground.';

const CEIL_HINT = 'Pick a gap to read exactly what throws and why.';

function buildCeiling(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ceil';

  const head = document.createElement('h3');
  head.className = 'ceil-head';
  head.textContent = 'THE HONEST CEILING — gaps loud-throw instead of faking success';

  const chips = document.createElement('div');
  chips.className = 'ceil-chips';
  const note = document.createElement('p');
  note.className = 'ceil-note';
  note.setAttribute('aria-live', 'polite');
  note.textContent = CEIL_HINT;

  const buttons = new Map<string, HTMLButtonElement>();
  let active: CeilDef | null = null;
  const select = (gap: CeilDef | null): void => {
    active = gap;
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === gap?.id));
    note.textContent = gap ? `${gap.chip}: ${gap.role}` : CEIL_HINT;
  };

  for (const gap of CEIL) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `ceil-chip ceil-chip-${gap.compat}`;
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute(
      'aria-label',
      `${gap.compat === 'no' ? 'Not supported' : 'Partial'}: ${gap.chip}`,
    );
    const glyph = document.createElement('span');
    glyph.className = 'ceil-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = gap.compat === 'no' ? '✕' : '⚠';
    chip.append(glyph, document.createTextNode(gap.chip));
    chip.addEventListener('click', () => select(active?.id === gap.id ? null : gap));
    buttons.set(gap.id, chip);
    chips.append(chip);
  }

  box.append(head, chips, note);
  return box;
}

/**
 * 02 — section chrome + intro + an empty explorer-root container + the honest
 * ceiling. main.ts mounts the explorer into #explorer-root; this file does
 * NOT import or call it.
 */
export function renderArch(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'arch';
  section.className = 'sec arch';

  const index = document.createElement('p');
  index.className = 'sec-index';
  index.textContent = '02 — HOW IT ACTUALLY WORKS';
  const title = document.createElement('h2');
  title.className = 'sec-title';
  title.textContent = 'One tab, four realms.';
  const intro = document.createElement('p');
  intro.className = 'sec-intro';
  intro.textContent = INTRO;

  const root = document.createElement('div');
  root.id = 'explorer-root';

  section.append(index, title, intro, root, buildCeiling());
  return section;
}
