import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';

// Goal project-location-independence I3: installed Vite carries no root-location
// policy, and a project placed at `/` takes the code paths real Node + Vite 7.3.6
// take at `/` (evidence §Root run 5, Linux container, Node 24.22.0).
const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const VITE7_UPSTREAM_CONFIG = execFileSync(
  'tar',
  [
    '-xOzf',
    fileURLToPath(
      new URL(
        '../integration/fixtures/registry/rollup-companions/packages/vite-7.3.6.tgz',
        import.meta.url,
      ),
    ),
    'package/dist/node/chunks/config.js',
  ],
  { encoding: 'utf8', maxBuffer: 1 << 28 },
);
// `npm pack vite@8.0.16` → `tar -xOzf … package/dist/node/chunks/node.js | shasum -a 256`.
const VITE8_UPSTREAM_NODE_CHUNK_SHA256 =
  'c3dd49d14b140acd79ce8f76d3b9c191dbe76713a47e15947c2efc65f453588b';

for (const variant of [
  { template: 'vite', chunk: 'config.js', upstream: sha256(VITE7_UPSTREAM_CONFIG) },
  { template: 'vite8', chunk: 'node.js', upstream: VITE8_UPSTREAM_NODE_CHUNK_SHA256 },
] as const) {
  test(`${variant.template}: installed dist/node/chunks/${variant.chunk} is upstream bytes`, async ({
    page,
  }) => {
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-vite-root-bytes-${variant.template}`,
      template: variant.template,
      setup: 'instant',
      persistence: 'ephemeral',
    });
    try {
      const chunk = await readOwnerFile(
        page,
        `/scratch/node_modules/vite/dist/node/chunks/${variant.chunk}`,
      );
      expect(chunk.ok, chunk.error).toBe(true);
      expect(sha256(chunk.text)).toBe(variant.upstream);
    } finally {
      await closeOwner(page);
    }
  });
}

const REACT_FILES = {
  '/package.json': `${JSON.stringify(
    {
      name: 'vite-at-root',
      private: true,
      type: 'module',
      scripts: { dev: 'vite' },
      dependencies: { react: '19.2.0', 'react-dom': '19.2.0' },
      devDependencies: { vite: '7.3.6', '@vitejs/plugin-react': '5.2.0' },
    },
    null,
    2,
  )}\n`,
  '/index.html':
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n',
  // Evidence run 5: the minimum that serves modules at `/` on real Node.
  '/vite.config.js': `import react from '@vitejs/plugin-react';
export default {
  plugins: [react()],
  server: { watch: null },
  optimizeDeps: { entries: ['index.html'] },
};
`,
  '/src/main.jsx': `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);
`,
  '/src/App.jsx': `export default function App() {
  return <h1>VITE_AT_ROOT</h1>;
}
`,
} as const;

async function servedModules(page: Page): Promise<{ html: string; main: string; app: string }> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const run = fixture.currentProject().run();
    try {
      const ready = await run.ready;
      const base = new URL(ready.url, location.href);
      const text = async (path: string): Promise<string> =>
        (await fetch(new URL(path, base), { cache: 'no-store' })).text();
      return {
        html: await text('index.html'),
        main: await text('src/main.jsx'),
        app: await text('src/App.jsx'),
      };
    } finally {
      await run.stop().catch(() => {});
      await run.close().catch(() => {});
    }
  }, sealedWorkbenchFixtureUrl);
}

for (const location of [
  { label: 'root /', publicProjectRoot: '/', split: true },
  { label: 'default', publicProjectRoot: undefined, split: false },
] as const) {
  test(`React Refresh module URLs at ${location.label} match real Node + Vite 7.3.6`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-vite-at-root-${location.label === 'root /' ? 'root' : 'default'}`,
      persistence: 'ephemeral',
      ...(location.publicProjectRoot === undefined
        ? {}
        : { publicProjectRoot: location.publicProjectRoot }),
      plan: {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite-at-root',
        templateId: 'vite-at-root',
        files: REACT_FILES,
        dependencies: { react: '19.2.0', 'react-dom': '19.2.0' },
        devDependencies: { vite: '7.3.6', '@vitejs/plugin-react': '5.2.0' },
        firstMaterialization: { kind: 'install' },
        port: 5174,
      },
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      const served = await servedModules(page);
      expect(served.html).toContain('import { injectIntoGlobalHook } from "/@react-refresh"');
      if (location.split) {
        expect(served.app).toContain('import * as RefreshRuntime from "/@id//@react-refresh"');
        expect(served.main).toContain('"/@id//src/App.jsx"');
      } else {
        expect(served.app).toContain('import * as RefreshRuntime from "/@react-refresh"');
        expect(served.main).toContain('"/src/App.jsx"');
      }
      if (location.split) {
        const build = await execLine(page, 'vite build');
        expect(build.exit, build.out).toBe(0);
        expect(build.out).toMatch(/✓ built in/u);
      }
    } finally {
      await closeOwner(page);
    }
  });
}

// Evidence §Root run 6 (watcher on, limited to the project tree): with no edit real
// Node + Vite 7.3.6 at `/` restarts on `vite.config.js` and re-emits root files.
const WATCHED_CONFIG = `import path from 'node:path';
import react from '@vitejs/plugin-react';
const keep = /^(?:src(?:\\/|$)|index\\.html$|vite\\.config\\.js$|package(?:-lock)?\\.json$|node_modules(?:\\/|$))/;
export default {
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: {
      ignored: (p) => {
        const rel = path.relative(process.cwd(), p);
        return rel !== '' && !keep.test(rel);
      },
    },
  },
};
`;

for (const location of [
  { label: 'root /', publicProjectRoot: '/', phantom: true },
  { label: 'default', publicProjectRoot: undefined, phantom: false },
] as const) {
  test(`watched dev server at ${location.label} matches real Node + Vite 7.3.6`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-vite-watch-${location.phantom ? 'root' : 'default'}`,
      persistence: 'ephemeral',
      ...(location.publicProjectRoot === undefined
        ? {}
        : { publicProjectRoot: location.publicProjectRoot }),
      plan: {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite-at-root',
        templateId: 'vite-at-root',
        files: REACT_FILES,
        dependencies: { react: '19.2.0', 'react-dom': '19.2.0' },
        devDependencies: { vite: '7.3.6', '@vitejs/plugin-react': '5.2.0' },
        firstMaterialization: { kind: 'install' },
        port: 5174,
      },
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/vite.config.js', WATCHED_CONFIG);
      // No edit during the window; the oracle saw the first restart within 1 s.
      const dev = await runOwnerCommand(page, 'vite --debug hmr', 20_000);
      const out = dev.out
        .replaceAll('\r', '')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: the terminal colors Vite's logger (TTY).
        .replace(/\u001b\[[0-9;]*m/gu, '');
      expect(out, out).toMatch(/VITE v7\.3\.6 {2}ready/u);
      const restarts = /vite\.config\.js changed, restarting server/u.test(out);
      const rootChange = /\[file change\] (?:index\.html|package\.json|package-lock\.json)/u.test(
        out,
      );
      expect({ restarts, rootChange }, out).toEqual({
        restarts: location.phantom,
        rootChange: location.phantom,
      });
    } finally {
      await closeOwner(page);
    }
  });
}
