import './arch.css';

const INTRO =
  'Pick a representative workflow and follow it through the browser runtime. Switch views or inspect a module when you want more detail.';

/**
 * "How it actually works" — section chrome + intro + an empty explorer-root
 * container. main.ts mounts the explorer into #explorer-root; this file does
 * NOT import or call it.
 */
export function renderArch(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'arch';
  section.className = 'arch';

  const head = document.createElement('div');
  head.className = 'arch-head';
  const index = document.createElement('span');
  index.className = 'arch-index';
  index.textContent = '03';
  const label = document.createElement('h2');
  label.className = 'arch-label';
  label.textContent = 'How it actually works';
  head.append(index, label);

  const intro = document.createElement('p');
  intro.className = 'arch-intro';
  intro.textContent = INTRO;

  const root = document.createElement('div');
  root.id = 'explorer-root';

  section.append(head, intro, root);
  return section;
}
