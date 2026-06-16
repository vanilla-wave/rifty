/**
 * Runtime-agnostic description of a "real npm project" template (ADR-0078).
 * Worker bootstrap, page-realm orchestrator, and mode machine are driven off
 * this value object instead of inline Vite literals, so a second runnable
 * template is a data change rather than a worker fork.
 *
 * Two runtimes (discriminated on `runtime`):
 * - `'vite'` — the worker imports `runtimeSpecifier` and boots its dev server
 *   (`createServer` + HMR bridge); the worker seeds an index.html for it.
 * - `'node-server'` — the worker imports the ENTRY itself; the entry is a
 *   long-running Node program (e.g. Express) that calls `listen(port)` and
 *   serves its own HTML. No index.html is seeded — it would shadow the server.
 *
 * Pure data + pure mapping function: no DOM, no channels, no solid-js (glue
 * altitude). Only `id` crosses a realm boundary (over env as
 * `RIFTY_RFV_TEMPLATE`); each realm re-resolves the full spec locally.
 */

/** Serializable subset of Vite's `createServer` knobs the worker reconstructs.
 *  Non-serializable plugin instances (the HMR-bridge plugin) are NOT here — the
 *  worker builds them from {@link ViteProjectSpec.hmr} after resolving the spec. */
export interface ServerSpec {
  readonly appType: string;
  readonly strictPort: boolean;
  readonly optimizeDepsDisabled: boolean;
  readonly host: boolean;
  readonly allowedHosts: boolean;
}

export interface ProjectEntry {
  /** Root-relative entry path with a leading slash (e.g. `/src/main.js`). */
  readonly relativePath: string;
  /** Initial entry-file contents, seeded before the editor source overwrites it. */
  readonly content: string;
}

interface ProjectSpecBase {
  /** Stable template key — the only field that crosses realms (over env). */
  readonly id: string;
  /** Generic UI label, replaces the hardcoded "Real Vite". */
  readonly displayName: string;
  /** npm dependencies to install into the worker-local node_modules. */
  readonly install: Readonly<Record<string, string>>;
  readonly entry: ProjectEntry;
  readonly defaultPort: number;
  readonly estimatedBootSeconds: number;
  /**
   * Same-origin URL of the baked node_modules snapshot (ADR-0135), produced by
   * `pnpm snapshots:bake`. When set and no install stamp matches, the worker
   * restores this tree instead of running `install()` — the first-ever boot of
   * an instant preset is truly instant. Absent → install as usual.
   */
  readonly bakedNodeModulesUrl?: string;
}

/** Template whose worker boots a Vite-shaped dev server from an npm package. */
export interface ViteProjectSpec extends ProjectSpecBase {
  readonly runtime: 'vite';
  /** Dynamic-`import()` specifier the worker loads to get the dev server. */
  readonly runtimeSpecifier: string;
  /** `<title>` for the seeded index.html. */
  readonly htmlTitle: string;
  readonly server: ServerSpec;
  readonly hmr: { readonly enabled: boolean };
}

/** Template whose worker runs the entry as a long-running Node server program. */
export interface NodeServerProjectSpec extends ProjectSpecBase {
  readonly runtime: 'node-server';
  /** Root-relative extra files the WORKER seeds BEFORE the server starts
   *  (e.g. `/public/*` for `express.static`) — page-side preset sync is too
   *  late for assets the first preview request already needs. */
  readonly extraFiles: Readonly<Record<string, string>>;
  /** Bring up the sql.js WASM engine (`node:sqlite`) before importing the entry. */
  readonly sqlite: boolean;
}

export type ProjectSpec = ViteProjectSpec | NodeServerProjectSpec;

interface BootstrapConfigBase {
  readonly root: string;
  readonly port: number;
  readonly entryPath: string;
  /** npm package name/version serialized into the seeded package.json. */
  readonly packageName: string;
  readonly packageVersion: string;
  /** Dependencies serialized into package.json; npm-client reads them from VFS. */
  readonly installDeps: Readonly<Record<string, string>>;
  /** Serialized package.json written into the project root. */
  readonly packageJson: string;
  /** Absolute-path → contents map the worker seeds idempotently. */
  readonly seedFiles: Readonly<Record<string, string>>;
  /** Carried from {@link ProjectSpecBase.bakedNodeModulesUrl}. */
  readonly bakedNodeModulesUrl?: string;
}

export interface ViteBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'vite';
  readonly runtimeSpecifier: string;
  readonly server: ServerSpec;
  readonly hmrEnabled: boolean;
}

export interface NodeServerBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'node-server';
  readonly sqlite: boolean;
}

export type BootstrapConfig = ViteBootstrapConfig | NodeServerBootstrapConfig;

/**
 * The `<script>` src is RELATIVE and DERIVED from the entry path, so seeded
 * HTML always agrees with the declared entry without escaping the routed
 * `/preview/<port>/` base.
 */
function buildIndexHtml(title: string, entryRelativePath: string): string {
  const scriptSrc = entryRelativePath.replace(/^\/+/, '');
  // Paint the dark preview bg from the FIRST frame: HMR does a full iframe reload
  // on every edit (hmr-bridge naive reload), and entry code that sets `body`
  // background via JS only applies after the module evaluates — so a bg-less
  // document flashes white between reload and eval. The initial CSS removes that.
  // Interim mitigation for the naive reload: TODO(backlog: playground/honest-vite-hmr)
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0;background:#101218}</style></head>
  <body>
    <div id="app"></div>
    <script type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
}

/**
 * The package.json `dev`/`start` script body for a spec — `'vite'` for the vite
 * runtime, `node <entry>` for a node server. Single source for the script the
 * page-realm `npm run` matcher recognises and the seeded package.json declares.
 */
export function devScriptCommand(spec: ProjectSpec): string {
  if (spec.runtime === 'vite') return 'vite';
  return `node ${spec.entry.relativePath.replace(/^\/+/, '')}`;
}

/**
 * The visible terminal line the playground runs to boot a template — the
 * lifecycle-owning `vite` command for vite templates, `npm run dev` (resolved
 * through the seeded package.json script) for node servers. The node line is
 * `cd <root> && …`-pinned: `npm run` reads package.json from the SESSION cwd,
 * and the auto-boot session may have a persisted/user cwd outside the project.
 */
export function terminalDevLine(spec: ProjectSpec, root: string): string {
  if (spec.runtime === 'vite') return 'vite';
  return `cd ${root} && npm run dev`;
}

/**
 * package.json `scripts` for a spec. Every alias (`dev`/`vite`/`start`) runs the
 * dev-server command, so `npm run <any>` here boots the dev server — the single
 * source the page realm uses to recognise `npm run <script>` dev lines (ADR-0146:
 * npm runs in the owner, but the lifecycle-owning dev line is intercepted page-side).
 */
export function projectScripts(spec: ProjectSpec): Record<string, string> {
  const body = devScriptCommand(spec);
  return spec.runtime === 'vite' ? { dev: body, vite: body } : { dev: body, start: body };
}

export function buildProjectPackageJson(spec: ProjectSpec): {
  readonly name: string;
  readonly version: string;
  readonly json: string;
} {
  const name = `rifty-${spec.id}-app`;
  const version = '0.0.0';
  const scripts = projectScripts(spec);
  const json = `${JSON.stringify(
    {
      name,
      version,
      private: true,
      type: 'module',
      scripts,
      dependencies: spec.install,
    },
    null,
    2,
  )}\n`;
  return { name, version, json };
}

/**
 * Pure mapping: ProjectSpec + resolved port/root → the config the worker
 * bootstrap uses for package.json seeding / `createServer()` / the seed step.
 * Unit-tested seam where entry/package.json/index.html drift surfaces as a red
 * test rather than a silent "works for vite, breaks for the next template".
 */
export function resolveBootstrapConfig(
  spec: ProjectSpec,
  port: number,
  root: string,
): BootstrapConfig {
  const entryPath = `${root}${spec.entry.relativePath}`;
  const pkg = buildProjectPackageJson(spec);
  const base = {
    root,
    port,
    entryPath,
    packageName: pkg.name,
    packageVersion: pkg.version,
    installDeps: spec.install,
    packageJson: pkg.json,
    ...(spec.bakedNodeModulesUrl ? { bakedNodeModulesUrl: spec.bakedNodeModulesUrl } : {}),
  };
  if (spec.runtime === 'node-server') {
    const seedFiles: Record<string, string> = {
      [entryPath]: spec.entry.content,
      [`${root}/package.json`]: pkg.json,
    };
    for (const [relPath, content] of Object.entries(spec.extraFiles)) {
      // Tolerate a missing leading slash — `${root}public/x` would silently
      // seed a sibling of root and express.static would 404 with no hint.
      const rel = relPath.startsWith('/') ? relPath : `/${relPath}`;
      seedFiles[`${root}${rel}`] = content;
    }
    return { ...base, runtime: 'node-server', sqlite: spec.sqlite, seedFiles };
  }
  const seedFiles: Record<string, string> = {
    [`${root}/index.html`]: buildIndexHtml(spec.htmlTitle, spec.entry.relativePath),
    [entryPath]: spec.entry.content,
    [`${root}/package.json`]: pkg.json,
  };
  return {
    ...base,
    runtime: 'vite',
    runtimeSpecifier: spec.runtimeSpecifier,
    server: spec.server,
    hmrEnabled: spec.hmr.enabled,
    seedFiles,
  };
}
