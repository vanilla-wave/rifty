import { sdkDocsUrl } from '../landing-config';
import './packages.css';

interface Pkg {
  readonly name: string;
  readonly desc: string;
}

// The 16 names `release.yml` publishes in lockstep under @riftydev (docs/public/publishing.md).
const PACKAGES: readonly Pkg[] = [
  { name: 'sdk', desc: 'umbrella + createSandbox()' },
  { name: 'io', desc: 'EventEmitter · Buffer · streams' },
  { name: 'vfs', desc: 'memory + OPFS, sync mirror' },
  { name: 'kernel', desc: 'processes · scheduling · IPC' },
  { name: 'net', desc: 'node:net/http/ws + sqlite' },
  { name: 'runtime-js', desc: 'CJS/ESM loader + builtins' },
  { name: 'runtime-wasi', desc: 'WASI preview1 for .wasm' },
  { name: 'npm-client', desc: 'semver · registry · link' },
  { name: 'shell', desc: 'bash-flavoured, over the VFS' },
  { name: 'terminal', desc: 'xterm.js wrapper' },
  { name: 'service-worker', desc: 'preview/HMR routing bridge' },
  { name: 'workbench', desc: 'project · session · run · preview API' },
  { name: 'git', desc: 'git over the VFS (isomorphic-git)' },
  { name: 'ts-language-service', desc: 'TypeScript LS over the VFS' },
  { name: 'shadow-registry', desc: 'npm substitution tables' },
  { name: 'eddy', desc: 'opt-in fast-install resolver service' },
];

/** 03 — the publishable package set behind the umbrella. */
export function renderPackages(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'packages';
  section.className = 'sec packages';

  const index = document.createElement('p');
  index.className = 'sec-index';
  index.textContent = '03 — THE PACKAGE GRAPH';
  const title = document.createElement('h2');
  title.className = 'sec-title';
  title.textContent = `One umbrella, ${PACKAGES.length === 16 ? 'sixteen' : String(PACKAGES.length)} packages.`;
  const intro = document.createElement('p');
  intro.className = 'sec-intro';
  intro.append(
    document.createTextNode(
      '@riftydev/sdk fronts twelve runtime layers on subpaths (@riftydev/sdk/vfs … /ts-language-service); each is also its own package. Workbench, shadow-registry and eddy ship standalone. Sixteen @riftydev names, all ESM with .d.ts, released in lockstep. ',
    ),
  );
  const docs = document.createElement('a');
  docs.className = 'packages-docs';
  docs.href = sdkDocsUrl;
  docs.append(document.createTextNode('SDK DOCS '));
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  docs.append(arrow);
  intro.append(docs);

  const grid = document.createElement('ul');
  grid.className = 'packages-grid';
  for (const pkg of PACKAGES) {
    const cell = document.createElement('li');
    cell.className = pkg.name === 'sdk' ? 'pkg pkg-sdk' : 'pkg';
    const name = document.createElement('span');
    name.className = 'pkg-name';
    name.textContent = pkg.name;
    const desc = document.createElement('span');
    desc.className = 'pkg-desc';
    desc.textContent = pkg.desc;
    cell.append(name, desc);
    grid.append(cell);
  }

  section.append(index, title, intro, grid);
  return section;
}
