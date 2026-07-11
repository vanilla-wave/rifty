/**
 * `EddyBundleV1` wire codec (ADR-0182 §3).
 *
 * The bundle is ONE store (uncompressed) tar containing:
 *   - `eddy-bundle.json` — the manifest (format tag, npm-client version, as-of
 *     stamp, and the per-tarball integrity map).
 *   - `package-lock.json` — the v3 lockfile bytes.
 *   - `tarballs/<safeName>-<version>.tgz` — each resolved package's ORIGINAL
 *     gzip tarball, passed through (NOT re-compressed: the outer tar is store).
 *
 * The client pre-seeds its `VfsTarballCache` + writes the lockfile from this,
 * then the existing lockfile fast path installs with zero packument network.
 *
 * One format definition, both directions: eddy imports {@link packEddyBundle},
 * the client imports {@link unpackEddyBundle} (the pack path tree-shakes out of
 * the browser build). The outer container is consumed only by rifty (eddy ↔
 * client), so the writer targets {@link parseTarEntries} — a POSIX `ustar`
 * header + GNU `L` long-name entries for paths over 100 bytes, mtime pinned to
 * 0 so the same closure yields byte-identical bundle bytes (the immutable
 * `closure-hash → bundle` CDN cache key, ADR-0182 §6).
 */

import { parseTarEntries } from './unpacker.ts';

export const EDDY_BUNDLE_FORMAT = 'EddyBundleV1' as const;

/** One resolved package's entry in the bundle manifest. */
export interface EddyBundleTarballEntry {
  /** Tar member path, e.g. `tarballs/ms-2.1.3.tgz`. */
  file: string;
  name: string;
  version: string;
  /** SRI the gzip bytes match — the client verifies bytes against THIS. */
  integrity: string;
}

/** The bundle manifest (`eddy-bundle.json`). */
export interface EddyBundleManifestV1 {
  format: typeof EDDY_BUNDLE_FORMAT;
  /** The `@riftydev/npm-client` version eddy resolved with (skew audit). */
  npmClientVersion: string;
  /** As-of stamp (ADR-0182 §6): when + against what eddy resolved. */
  asOf: {
    /** ISO-8601 resolution timestamp. */
    resolvedAt: string;
    /** Upstream registry base URL eddy resolved against. */
    registry: string;
    /** Stable hash of the resolved closure (the immutable artifact key). */
    closureHash: string;
  };
  tarballs: EddyBundleTarballEntry[];
}

/** Bundle contents: manifest + lockfile text + each tarball's bytes. */
export interface EddyBundleContents {
  manifest: EddyBundleManifestV1;
  lockfileText: string;
  tarballs: Array<{ entry: EddyBundleTarballEntry; bytes: Uint8Array }>;
  /** Present on unpacked bundles: EVERY member name in the container, in order
   * — including ones the manifest does not claim. Optional so existing callers
   * can still construct `EddyBundleContents` for pack/mutate tests. */
  memberNames?: string[];
}

export interface UnpackedEddyBundleContents extends EddyBundleContents {
  memberNames: string[];
}

/** Bundle member names — fixed order `manifest → lockfile → tarballs/*` (the
 * streaming client gates on the first two before any tarball bytes arrive). */
export const MANIFEST_FILE = 'eddy-bundle.json';
export const LOCKFILE_FILE = 'package-lock.json';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** ISO-8601 shape + parseable + calendar-valid — `Date.parse` alone accepts
 * junk like `"July 10"` AND silently rolls impossible dates over
 * (`2026-02-30` → March 2); the manifest's `asOf.resolvedAt` honesty stamp
 * must render a real timestamp or be dropped, never junk on the terminal. */
export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const shape = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/.exec(value);
  if (!shape || Number.isNaN(Date.parse(value))) return false;
  // Out-of-range TIME fields already fail Date.parse (NaN); the literal
  // month/day need their own check against the rollover.
  const year = Number(shape[1]);
  const month = Number(shape[2]);
  const day = Number(shape[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // `Date.UTC(y, month, 0)` = day 0 of the NEXT month = the last day of `month`.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `width-1` octal digits (zero-padded, low bits kept) + a NUL terminator. */
function octalField(value: number, width: number): string {
  const digits = value
    .toString(8)
    .padStart(width - 1, '0')
    .slice(-(width - 1));
  return `${digits}\0`;
}

/** Build one 512-byte POSIX `ustar` header. `name` over 100 bytes is truncated
 * here and carried by a preceding GNU `L` entry (see {@link emitFile}). */
function tarHeader(name: string, size: number, typeflag: '0' | 'L'): Uint8Array {
  const h = new Uint8Array(512);
  const writeStr = (s: string, off: number, len: number): void => {
    h.set(encoder.encode(s).subarray(0, len), off);
  };
  writeStr(name, 0, 100);
  writeStr(octalField(0o644, 8), 100, 8); // mode
  writeStr(octalField(0, 8), 108, 8); // uid
  writeStr(octalField(0, 8), 116, 8); // gid
  writeStr(octalField(size, 12), 124, 12); // size
  writeStr(octalField(0, 12), 136, 12); // mtime — pinned 0 (deterministic bytes)
  for (let i = 148; i < 156; i++) h[i] = 0x20; // checksum placeholder = 8 spaces
  h[156] = typeflag.charCodeAt(0);
  writeStr('ustar', 257, 6); // magic "ustar\0" (byte 262 stays 0)
  h[263] = 0x30; // version "00"
  h[264] = 0x30;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i] ?? 0;
  writeStr(sum.toString(8).padStart(6, '0').slice(-6), 148, 6);
  h[154] = 0; // checksum NUL
  h[155] = 0x20; // checksum trailing space
  return h;
}

function pad512(data: Uint8Array): Uint8Array {
  const rem = data.length % 512;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (512 - rem));
  out.set(data);
  return out;
}

/** Append one file (with a GNU long-name prefix entry when the path > 100 bytes). */
function emitFile(chunks: Uint8Array[], name: string, data: Uint8Array): void {
  if (encoder.encode(name).length > 100) {
    const nameBytes = encoder.encode(name);
    const body = new Uint8Array(nameBytes.length + 1); // NUL-terminated long name
    body.set(nameBytes);
    chunks.push(tarHeader('././@LongLink', body.length, 'L'));
    chunks.push(pad512(body));
  }
  chunks.push(tarHeader(name, data.length, '0'));
  chunks.push(pad512(data));
}

/** Serialize bundle contents to `EddyBundleV1` tar bytes. */
/** Pack input: the layout (`manifest → lockfile → tarballs/*`) is DERIVED, so
 * `memberNames` — an unpack observation — is ignored when present. */
export type EddyBundleSource = EddyBundleContents;

export function packEddyBundle(contents: EddyBundleSource): Uint8Array {
  const chunks: Uint8Array[] = [];
  emitFile(chunks, MANIFEST_FILE, encoder.encode(JSON.stringify(contents.manifest)));
  emitFile(chunks, LOCKFILE_FILE, encoder.encode(contents.lockfileText));
  for (const t of contents.tarballs) {
    emitFile(chunks, t.entry.file, t.bytes);
  }
  chunks.push(new Uint8Array(1024)); // two zero blocks — end of archive
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Parse `EddyBundleV1` tar bytes back into contents. Throws if the bytes are
 * not a valid bundle (missing/format-mismatched manifest, missing lockfile, or
 * a manifest tarball entry with no matching tar member). */
export function unpackEddyBundle(bytes: Uint8Array): UnpackedEddyBundleContents {
  const byName = new Map<string, Uint8Array>();
  const memberNames: string[] = [];
  for (const e of parseTarEntries(bytes)) {
    byName.set(e.name, e.data);
    memberNames.push(e.name);
  }

  const manifestBytes = byName.get(MANIFEST_FILE);
  if (!manifestBytes) {
    throw new Error('Not an EddyBundleV1 bundle: missing eddy-bundle.json');
  }
  let manifest: EddyBundleManifestV1;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as EddyBundleManifestV1;
  } catch (err) {
    throw new Error(
      `Malformed EddyBundleV1 manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (manifest.format !== EDDY_BUNDLE_FORMAT) {
    throw new Error(`Unsupported EddyBundle format: ${JSON.stringify(manifest.format)}`);
  }

  const lockBytes = byName.get(LOCKFILE_FILE);
  if (!lockBytes) {
    throw new Error('Malformed EddyBundleV1 bundle: missing package-lock.json');
  }

  const tarballs = manifest.tarballs.map((entry) => {
    const data = byName.get(entry.file);
    if (!data) {
      throw new Error(`Malformed EddyBundleV1 bundle: missing tarball member ${entry.file}`);
    }
    return { entry, bytes: data };
  });

  return { manifest, lockfileText: decoder.decode(lockBytes), tarballs, memberNames };
}
