/**
 * Synthetic in-process registry (test helper) for cases the vendored
 * `tests/integration/fixtures` registry can't express — chiefly the
 * ADR-0051 native gate (a package pinning `cpu` to a non-wasm target).
 *
 * Serves real gzip `.tgz` bytes (a one-file tar of `package/package.json`)
 * so the resolver runs the genuine fetch + extract path; the registry is the
 * allowed external boundary (CLAUDE.md §Fidelity).
 */
import { gzipSync } from 'node:zlib';
import type { Fetcher, Packument, VersionManifest } from '@riftydev/npm-client';

export interface SyntheticPackageSpec {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** ADR-0051 platform constraints. `cpu: ['x64']` marks an unrunnable native. */
  cpu?: string[];
  os?: string[];
}

const BASE_URL = 'synthetic:';
const enc = new TextEncoder();

function octal(value: number, width: number): string {
  return `${value
    .toString(8)
    .padStart(width - 1, '0')
    .slice(-(width - 1))}\0`;
}

/** Minimal single-file USTAR archive (uncompressed). */
function ustarSingleFile(path: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const put = (s: string, off: number, len: number): void => {
    header.set(enc.encode(s).subarray(0, len), off);
  };
  put(path, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(data.length, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30; // typeflag '0'
  put('ustar', 257, 6);
  header[263] = 0x30;
  header[264] = 0x30;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  put(sum.toString(8).padStart(6, '0').slice(-6), 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  const padLen = (512 - (data.length % 512)) % 512;
  const out = new Uint8Array(512 + data.length + padLen + 1024);
  out.set(header, 0);
  out.set(data, 512);
  return out;
}

function tarballFor(spec: SyntheticPackageSpec): Uint8Array {
  const pkgJson = enc.encode(JSON.stringify({ name: spec.name, version: spec.version }));
  const tar = ustarSingleFile('package/package.json', pkgJson);
  return new Uint8Array(gzipSync(tar));
}

function tarballUrl(spec: SyntheticPackageSpec): string {
  return `${BASE_URL}tarball/${encodeURIComponent(spec.name)}/${spec.version}`;
}

function versionManifest(spec: SyntheticPackageSpec): VersionManifest {
  const m: VersionManifest = {
    name: spec.name,
    version: spec.version,
    dist: { tarball: tarballUrl(spec) },
  };
  if (spec.dependencies) m.dependencies = spec.dependencies;
  if (spec.optionalDependencies) m.optionalDependencies = spec.optionalDependencies;
  if (spec.cpu) m.cpu = spec.cpu;
  if (spec.os) m.os = spec.os;
  return m;
}

export interface SyntheticRegistry {
  fetch: Fetcher;
  baseUrl: string;
}

/** Build a `Fetcher` + base URL serving the given synthetic packages. */
export function makeSyntheticRegistry(specs: SyntheticPackageSpec[]): SyntheticRegistry {
  const packuments = new Map<string, Packument>();
  const tarballs = new Map<string, Uint8Array>();
  for (const spec of specs) {
    const pack = packuments.get(spec.name) ?? {
      name: spec.name,
      'dist-tags': {},
      versions: {},
    };
    pack.versions[spec.version] = versionManifest(spec);
    pack['dist-tags'] = { latest: spec.version }; // last spec for a name wins latest
    packuments.set(spec.name, pack);
    tarballs.set(tarballUrl(spec), tarballFor(spec));
  }

  const fetch: Fetcher = async (url: string): Promise<Response> => {
    if (url.startsWith(`${BASE_URL}tarball/`)) {
      const bytes = tarballs.get(url);
      if (!bytes) return new Response('', { status: 404 });
      return new Response(bytes as unknown as BodyInit, { status: 200 });
    }
    const name = url.slice(BASE_URL.length).replace(/^\/+/, '');
    const pack = packuments.get(decodeURIComponent(name));
    if (!pack) return new Response('', { status: 404 });
    return new Response(JSON.stringify(pack), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, baseUrl: BASE_URL };
}
