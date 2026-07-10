// Landing entry. Wires the design tokens + base reset, mounts every section into
// #app in document order, then mounts the interactive explorer into the
// #explorer-root container rendered by the arch section.

import { mountExplorer } from './explorer/explorer';
import { renderArch } from './sections/arch';
import { renderCtaFooter } from './sections/cta-footer';
import { renderDemos } from './sections/demos';
import { renderHero } from './sections/hero';
import { renderNav } from './sections/nav';
import { renderQuickStart } from './sections/quickstart';
import { renderWhat } from './sections/what';
import './styles/tokens.css';
import './styles/base.css';

const app = document.getElementById('app');
if (!app) {
  throw new Error('landing: #app container missing from index.html');
}

app.append(
  renderNav(),
  renderHero(),
  renderDemos(),
  renderWhat(),
  renderArch(),
  renderQuickStart(),
  renderCtaFooter(),
);

const root = document.getElementById('explorer-root');
if (root) {
  // mountExplorer returns a disposer (removes window listeners + clears timers).
  // The landing is a single static page so we never tear down here, but exposing
  // the disposer keeps the widget re-mount/SPA-safe and documents the contract.
  const disposeExplorer = mountExplorer(root);
  (window as Window & { __riftyDisposeExplorer?: () => void }).__riftyDisposeExplorer =
    disposeExplorer;
}
