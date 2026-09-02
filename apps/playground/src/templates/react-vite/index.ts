/**
 * React + Vite issue-tracker template (backlog: playground/react-vite-starter).
 * An ordinary mid-size client SPA — React 19 + TS + React Router 7 +
 * `@vitejs/plugin-react` on Vite 7 — deliberately NOT a minimal toy: it is the
 * "Real npm project" tile and the arena a coding agent is asked to work in.
 *
 * The seeded tree is a self-sufficient npm project: zero sandbox-specific code
 * or config, its own `index.html`/`vite.config.ts`/`tsconfig.json`, pinned by
 * `react-vite.test.ts`. Source split by file group (app / pages / components /
 * data / styles / project files) to stay inside `pnpm check:file-size`.
 */
import type { ViteProjectSpec } from '../project-spec.ts';
import { APP_TSX, MAIN_TSX } from './app.ts';
import { FILTER_BAR_TSX, ISSUE_CARD_TSX, STATUS_BADGE_TSX } from './components.ts';
import { ISSUES_DATA_TS } from './data.ts';
import { DASHBOARD_TSX, ISSUE_DETAIL_TSX, ISSUE_LIST_TSX, SETTINGS_TSX } from './pages.ts';
import { INDEX_HTML, README_MD, TSCONFIG_JSON, VITE_CONFIG_TS } from './project.ts';
import { GLOBAL_CSS, ISSUES_CSS } from './styles.ts';

export const REACT_VITE_TEMPLATE: ViteProjectSpec = {
  id: 'react-vite',
  displayName: 'React issue tracker',
  runtime: 'vite',
  install: {
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    'react-router-dom': '^7.0.0',
  },
  // The ordinary create-vite split. `@rollup/wasm-node` is NOT pinned here: the
  // installer injects it as rollup's same-version shadow-shim companion
  // (ADR-0188) — a hand pin would drift and would break portability.
  devDependencies: {
    '@types/react': '^19.0.0',
    '@types/react-dom': '^19.0.0',
    '@vitejs/plugin-react': '^5.0.0',
    typescript: '^5.0.0',
    vite: '^7.0.0',
  },
  // Standard portable scripts on top of the lifecycle-owned dev aliases.
  scripts: {
    build: 'vite build',
    preview: 'vite preview',
  },
  // No `bakedNodeModulesUrl`: this tile is `setup: 'from-scratch'` — the
  // terminal runs a visible `npm install` (ADR-0135).
  entry: { relativePath: '/src/main.tsx', content: MAIN_TSX },
  defaultPort: 5174,
  estimatedBootSeconds: 30,
  htmlTitle: 'Trackline',
  extraFiles: {
    '/index.html': INDEX_HTML,
    '/vite.config.ts': VITE_CONFIG_TS,
    '/tsconfig.json': TSCONFIG_JSON,
    '/README.md': README_MD,
    '/src/App.tsx': APP_TSX,
    '/src/pages/Dashboard.tsx': DASHBOARD_TSX,
    '/src/pages/IssueList.tsx': ISSUE_LIST_TSX,
    '/src/pages/IssueDetail.tsx': ISSUE_DETAIL_TSX,
    '/src/pages/Settings.tsx': SETTINGS_TSX,
    '/src/components/IssueCard.tsx': ISSUE_CARD_TSX,
    '/src/components/FilterBar.tsx': FILTER_BAR_TSX,
    '/src/components/StatusBadge.tsx': STATUS_BADGE_TSX,
    '/src/data/issues.ts': ISSUES_DATA_TS,
    '/src/styles/global.css': GLOBAL_CSS,
    '/src/styles/issues.css': ISSUES_CSS,
  },
};
