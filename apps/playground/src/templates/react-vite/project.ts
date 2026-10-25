/**
 * Project-level files an ordinary `create-vite`-shaped React app carries:
 * its own index.html, visible `vite.config.ts` (ADR-0174), tsconfig, README.
 */

/**
 * Overrides the generated index.html (project-spec's derived-entry HTML seeds
 * `#app`): the same bytes locally and in the worker, mounting `#root`.
 */
export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trackline</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

/**
 * The optimizer stays ON (no `noDiscovery`): CJS `react`/`react-dom` must be
 * pre-bundled with `needsInterop`, and `@vitejs/plugin-react` injects its own
 * `optimizeDeps.include` — that IS the behavior this starter proves.
 */
export const VITE_CONFIG_TS = `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
});
`;

export const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

/** Names the four planted rough edges — they are the point of the seed. */
export const README_MD = `# Trackline

An ordinary React 19 + TypeScript issue tracker: React Router 7,
\`@vitejs/plugin-react\` Fast Refresh, plain CSS, a mock dataset in
\`src/data/issues.ts\`. Nothing here is specific to this sandbox — the same tree
runs anywhere Vite 7 runs.

## Rough edges to fix

1. **Dashboard "Recently filed" is misordered.** \`src/pages/Dashboard.tsx\`
   compares \`createdAt\` as text, and some dates in the dataset are not
   zero-padded (\`2025-9-14\`), so they sort as if they were the newest.
2. **The issue list has no search.** \`src/pages/IssueList.tsx\` filters by
   status and assignee only; there is no way to find an issue by title.
3. **Filters vanish on reload.** They live in component state, never in the
   URL, so a filtered list cannot be shared or restored.
4. **No way to file an issue.** The dataset is read-only; there is no
   new-issue form anywhere in the app.
`;
