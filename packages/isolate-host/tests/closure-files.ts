/**
 * A package's installed closure as an npm-style `node_modules` tree and its live Node oracle
 * (library tests, ADR-0568). No sandbox import: the browser-host specs load it too.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/** Where `name` resolves from package dir `from` (Node's walk up `node_modules`), real path. */
function resolvePackage(name: string, from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    try {
      return realpathSync(join(dir, 'node_modules', name));
    } catch {}
    if (dirname(dir) === dir) throw new Error(`${name} not installed for ${from}`);
  }
}

/**
 * The installed closure of `root` as an npm-style tree: `node_modules/<path>` → package dir.
 * A dependency goes to the nearest slot up its dependent's chain, or to the root when free,
 * nested under its dependent when the nearest slot holds another copy.
 */
function closureTree(name: string, root: string): Map<string, string> {
  const slots = new Map<string, string>();
  const place = (pkgDir: string, at: string): void => {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      const depDir = resolvePackage(dep, pkgDir);
      let found: string | undefined;
      for (let scope = at; ; scope = scope.slice(0, scope.lastIndexOf('/node_modules/'))) {
        const slot = `${scope}/node_modules/${dep}`;
        if (slots.has(slot)) {
          found = slot;
          break;
        }
        if (!scope.includes('/node_modules/')) break;
      }
      if (found !== undefined && slots.get(found) === depDir) continue;
      const slot =
        found === undefined && !slots.has(`/node_modules/${dep}`)
          ? `/node_modules/${dep}`
          : `${at}/node_modules/${dep}`;
      slots.set(slot, depDir);
      place(depDir, slot);
    }
  };
  slots.set(`/node_modules/${name}`, root);
  place(root, `/node_modules/${name}`);
  return slots;
}

/** Every file of the closure: workspace-relative path → bytes (a package's own `node_modules` excluded). */
export function closureFiles(name: string, root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [slot, dir] of closureTree(name, root)) {
    const walk = (abs: string): void => {
      for (const name of readdirSync(abs).sort()) {
        const path = join(abs, name);
        if (statSync(path).isDirectory()) {
          if (!(abs === dir && name === 'node_modules')) walk(path);
        } else files.set(`${slot.slice(1)}/${relative(dir, path)}`, readFileSync(path));
      }
    };
    walk(dir);
  }
  return files;
}

/** `node <gen> <out>` over `files`; `file`: `out`'s bytes after the run, if written. */
export interface Outcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly file?: Uint8Array;
}

export function inNode(
  files: Map<string, Uint8Array>,
  gen: string,
  out: string,
  flags: readonly string[] = [],
): Outcome {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-host-library-oracle-')));
  try {
    for (const [rel, data] of files) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
    const r = spawnSync(process.execPath, [...flags, gen, out], {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: 60_000,
    });
    let file: Uint8Array | undefined;
    try {
      file = readFileSync(join(dir, out));
    } catch {}
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
