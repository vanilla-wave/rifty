/**
 * Object-Storage BundleStore (ADR-0194 §4): bundles live in an S3-compatible
 * public-read bucket behind the CDN; the origin stays stateless-restartable.
 *
 * Reads (GET/HEAD) are plain unsigned fetches — the bucket is public-read by
 * deployment contract (`docs/public/hosting-eddy.md`), exactly what the CDN
 * itself does. Only PUT is signed (SigV4, `sigv4.ts`).
 *
 * Object key = `bundle/<closureHash>` with the hash RAW (base64 `/`+`=`
 * kept): the client's `bundleUrlFor` percent-encodes the hash and S3
 * percent-decodes the request path, so a CDN origin re-point VM → bucket
 * changes nothing on the wire. The manifest is recovered from the bundle
 * bytes on `get` (it IS the first tar member) — no sidecar metadata to drift.
 *
 * Every network op is BOUNDED (per-op deadline, body byte cap): `EddyCache`
 * awaits store calls before replying, so a stalled bucket must fail loudly
 * into the existing degrade paths, never park the server.
 */
import { createHash } from 'node:crypto';
import {
  LOCKFILE_FILE,
  type Lockfile,
  MANIFEST_FILE,
  type UnpackedEddyBundleContents,
  bundleCompletenessGap,
  closureHashOf,
  computeIntegrity,
  parseIntegrityAlgorithm,
  unpackEddyBundle,
} from '@riftydev/npm-client';
import type { BundleStore } from './bundle-store.ts';
import type { CachedBundle } from './cache.ts';
import { signV4 } from './sigv4.ts';

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';

/** Per-network-op deadline (headers + full body). `EddyCache` AWAITS store
 * calls before replying, so an unbounded bucket op parks the whole POST/GET —
 * every op must SETTLE (same class the client fixed for bundle streams). */
const DEFAULT_OP_TIMEOUT_MS = 30_000;
/** Mirrors the client's `DEFAULT_BUNDLE_MAX_BYTES` (eddy-bundle-stream.ts,
 * deliberately unexported): real bundles are single-digit MB; the cap only
 * guards a runaway body. */
const DEFAULT_MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
/** Error-body snippet cap — enough for any S3 XML error, never a full object. */
const ERROR_SNIPPET_BYTES = 4096;

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface S3BundleStoreOptions {
  /** Storage endpoint, e.g. `https://storage.yandexcloud.net`. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injectable fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for the signature date (tests pin it). */
  now?: () => Date;
  /** Per-network-op deadline in ms (default {@link DEFAULT_OP_TIMEOUT_MS}). */
  opTimeoutMs?: number;
  /** Body byte cap for reads (default {@link DEFAULT_MAX_BUNDLE_BYTES}). */
  maxBundleBytes?: number;
}

export class S3BundleStore implements BundleStore {
  private readonly opts: S3BundleStoreOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: S3BundleStoreOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private urlFor(closureHash: string): URL {
    const base = this.opts.endpoint.replace(/\/+$/, '');
    return new URL(`${base}/${this.opts.bucket}/bundle/${encodeURIComponent(closureHash)}`);
  }

  /**
   * Run one network op under a hard deadline. The abort cancels a
   * signal-honoring fetch; the race REJECTS regardless, so a fetch that
   * ignores the signal — or a body that stalls/streams forever — still cannot
   * park the caller. The deadline spans headers AND body (a stalled body after
   * a fast 200 is the same hang).
   */
  private async boundedOp<T>(what: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeoutMs = this.opts.opTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = run(controller.signal);
    attempt.catch(() => {}); // a raced-out attempt settles later (abort) — never unhandled
    try {
      return await Promise.race([
        attempt,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`eddy: bundle store ${what} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async get(closureHash: string): Promise<CachedBundle | null> {
    const maxBytes = this.opts.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
    const bytes = await this.boundedOp(`GET ${closureHash}`, async (signal) => {
      const res = await this.fetchImpl(this.urlFor(closureHash), { signal });
      if (res.status === 404) {
        discardBody(res);
        return null;
      }
      if (!res.ok) {
        discardBody(res);
        throw new Error(`eddy: bundle store GET ${closureHash} failed: HTTP ${res.status}`);
      }
      return readBodyBounded(res, maxBytes, `GET ${closureHash}`);
    });
    if (!bytes) return null;
    return this.verifyContentAddress(closureHash, bytes);
  }

  /**
   * A store HIT is a bundle that FULLY content-addresses to its key. The
   * manifest's self-reported hash is NOT trusted: the object must (1) unpack,
   * (2) self-report the key, (3) RE-DERIVE the key from its own lockfile
   * (`closureHashOf`), and (4) carry tarball bytes matching the integrity its
   * manifest names. Any failure reads as a MISS so the compute-path `put()`
   * re-seeds the key — a forged/poisoned object (matching key, tampered
   * lockfile/tarball) can't linger as a permanent GET-by-hash hit the client
   * only rejects later. The extra hashing is marginal next to the object fetch.
   */
  private async verifyContentAddress(
    closureHash: string,
    bytes: Uint8Array,
  ): Promise<CachedBundle | null> {
    let contents: UnpackedEddyBundleContents;
    try {
      contents = unpackEddyBundle(bytes);
    } catch (err) {
      console.error(
        `eddy: bundle store object for ${closureHash} is not a valid bundle: ${errMsg(err)}`,
      );
      return null;
    }
    const { manifest, lockfileText, tarballs, memberNames } = contents;
    // The manifest parsed as JSON but may still be the WRONG SHAPE (missing
    // `asOf`, non-array `tarballs`): validate before dereferencing — a
    // malformed-but-parseable object must read as a poisoned MISS
    // (self-heal), never throw into the direct GET route as a 500.
    if (!manifestShapeOk(manifest)) {
      console.error(
        `eddy: bundle store object at ${closureHash} has a malformed manifest shape — treating as a miss`,
      );
      return null;
    }
    // Same malformed shape CLIENT adoption declines: duplicate `file` values
    // let two required name@version entries share one member (partial bundle).
    const files = new Set<string>();
    for (const t of manifest.tarballs) {
      if (files.has(t.file)) {
        console.error(
          `eddy: bundle store object at ${closureHash} names duplicate member ${t.file} — treating as a miss`,
        );
        return null;
      }
      files.add(t.file);
    }
    // The raw member SEQUENCE must match what the streaming client accepts:
    // manifest FIRST, lockfile SECOND, then ONLY manifest-named tarballs.
    // This also rejects duplicate reserved members (a second eddy-bundle.json
    // / package-lock.json later in the tar): `unpackEddyBundle`'s by-name map
    // keeps the LAST occurrence, so a poisoned object could pass every
    // content gate here while the streaming client — which reads the FIRST —
    // declines it (`unexpected bundle member`): a permanent hit strict
    // clients bounce.
    if (memberNames[0] !== MANIFEST_FILE || memberNames[1] !== LOCKFILE_FILE) {
      console.error(
        `eddy: bundle store object at ${closureHash} does not start manifest→lockfile — treating as a miss`,
      );
      return null;
    }
    const seenMembers = new Set<string>();
    for (const name of memberNames.slice(2)) {
      if (!files.has(name)) {
        console.error(
          `eddy: bundle store object at ${closureHash} carries an unexpected member ${name} — treating as a miss`,
        );
        return null;
      }
      // Reject a DUPLICATE tarball member (both occurrences manifest-named, so
      // the loop above passes each): `unpackEddyBundle`'s by-name map keeps ONE
      // occurrence while the streaming client verifies whichever it reads first —
      // a good/bad pair could verify as a HIT here yet be DECLINED by strict
      // clients (integrity mismatch), a permanent hit self-heal never clears.
      if (seenMembers.has(name)) {
        console.error(
          `eddy: bundle store object at ${closureHash} names a DUPLICATE member ${name} — treating as a miss`,
        );
        return null;
      }
      seenMembers.add(name);
    }
    if (manifest.asOf.closureHash !== closureHash) {
      console.error(
        `eddy: bundle store object at ${closureHash} carries a different closure hash ${manifest.asOf.closureHash} — treating as a miss`,
      );
      return null;
    }
    let lockfile: Lockfile;
    let derived: string;
    try {
      lockfile = JSON.parse(lockfileText) as Lockfile;
      derived = await closureHashOf(lockfile);
    } catch (err) {
      console.error(
        `eddy: bundle store object for ${closureHash} has an unparseable lockfile: ${errMsg(err)}`,
      );
      return null;
    }
    // The closure hash canonicalizes `packages` ONLY, so a v1/v2-mutated
    // lockfile still re-derives to the key — yet every CLIENT rejects non-v3
    // bundles. Serving it would be a permanent hit stricter clients bounce.
    if ((lockfile.lockfileVersion as number) !== 3) {
      console.error(
        `eddy: bundle store object at ${closureHash} has a non-v3 lockfile (${JSON.stringify(lockfile.lockfileVersion)}) — treating as a miss`,
      );
      return null;
    }
    if (derived !== closureHash) {
      console.error(
        `eddy: bundle store object at ${closureHash} re-derives to ${derived} from its lockfile — treating as a miss`,
      );
      return null;
    }
    // At least as strict as CLIENT adoption (`consumeEddyResponse`): a
    // poisoned object can keep its lockfile (same closure hash) while OMITTING
    // a reachable tarball from both manifest and members — the tarball loop
    // below only checks what the manifest NAMES. Reuse the client's own gate
    // (roots = the lockfile root entry's deps = the original request) so a hit
    // the client would reject reads as a MISS here and self-heals on the next
    // compute's put.
    const rootDeps = lockfile.packages?.['']?.dependencies ?? {};
    const gap = bundleCompletenessGap(lockfile, rootDeps, manifest.tarballs);
    if (gap) {
      console.error(
        `eddy: bundle store object at ${closureHash} is incomplete (${gap}) — treating as a miss`,
      );
      return null;
    }
    for (const t of manifest.tarballs) {
      const found = tarballs.find((x) => x.entry.file === t.file);
      const algorithm = found ? parseIntegrityAlgorithm(t.integrity) : null;
      if (
        !found ||
        !algorithm ||
        (await computeIntegrity(found.bytes, algorithm)) !== t.integrity
      ) {
        console.error(
          `eddy: bundle store object at ${closureHash} has a bad/absent tarball ${t.file} — treating as a miss`,
        );
        return null;
      }
    }
    return { bytes, manifest };
  }

  async put(closureHash: string, bundle: CachedBundle): Promise<void> {
    const url = this.urlFor(closureHash);
    // Self-heal + skip-identical (ADR-0194 §5): HEAD first. S3 returns the
    // single-part PUT's ETag = MD5-hex of the body, so a byte-identical object is
    // already durable → skip the upload. A non-matching object is read through
    // `get()`: valid content-addressed bytes win (first writer wins), while a
    // poisoned miss is overwritten so GET-by-hash heals. A non-MD5 ETag (bucket
    // default-encryption, multipart) never matches, so the verified GET path
    // decides instead of trusting the opaque tag.
    // Skip ONLY when the metadata is ALSO already immutable — an existing
    // same-byte object missing the `Cache-Control` header (an older upload) still
    // gets re-PUT to repair the metadata the CDN path depends on.
    let bundleToStore = bundle;
    let bodyMd5Hex = createHash('md5').update(bundleToStore.bytes).digest('hex');
    // The probe is an OPTIMIZATION: any failure (network, timeout) → PUT anyway.
    const probe = await this.boundedOp(`HEAD ${closureHash} (probe)`, async (signal) => {
      const head = await this.fetchImpl(url, { method: 'HEAD', signal });
      discardBody(head); // empty by spec
      return {
        ok: head.ok,
        status: head.status,
        etagMatch: (head.headers.get('etag') ?? '').replace(/"/g, '') === bodyMd5Hex,
        immutable: head.headers.get('cache-control') === CACHE_CONTROL_IMMUTABLE,
      };
    }).catch(() => null);
    if (probe?.ok && probe.etagMatch && probe.immutable) {
      return; // identical object already durable WITH the immutable header — no re-upload
    }
    if (probe?.ok && !probe.etagMatch) {
      // Another origin may have stored the FIRST artifact for this closure
      // already. Preserve that verified content-addressed object; if its
      // metadata is missing, repair by re-PUTing THOSE bytes, never fresh
      // recompute bytes with a different as-of stamp.
      const existing = await this.get(closureHash);
      if (existing) {
        if (probe.immutable) return;
        bundleToStore = existing;
        bodyMd5Hex = createHash('md5').update(bundleToStore.bytes).digest('hex');
      }
    }
    const payloadSha256Hex = createHash('sha256').update(bundleToStore.bytes).digest('hex');
    const amzDate = toAmzDate(this.opts.now ? this.opts.now() : new Date());
    const headers: Record<string, string> = {
      // Immutable content-addressed object: S3 stores this as system metadata and
      // echoes it on GET, so the bucket-backed CDN path serves bundles with the
      // same forever-cacheable header the origin GET route sets (ADR-0194 §4).
      // Signed with the rest — it is part of the canonical request when sent.
      'cache-control': CACHE_CONTROL_IMMUTABLE,
      host: url.host,
      'content-type': 'application/x-tar',
      'x-amz-content-sha256': payloadSha256Hex,
      'x-amz-date': amzDate,
    };
    const conditionalCreate = !probe || !probe.ok;
    if (conditionalCreate) {
      // Apparent miss: create-only avoids the two-origin HEAD-miss race where
      // the loser overwrites the winner's immutable bytes for the same hash.
      headers['if-none-match'] = '*';
    }
    const authorization = signV4({
      method: 'PUT',
      path: url.pathname,
      query: '',
      headers,
      payloadSha256Hex,
      accessKeyId: this.opts.accessKeyId,
      secretAccessKey: this.opts.secretAccessKey,
      region: this.opts.region,
      service: 's3',
      amzDate,
    });
    // `host` rides the connection itself; sending it again as an option is
    // ignored by fetch — it is signed above because S3 requires it signed.
    const { host: _host, ...sendHeaders } = headers;
    const putOutcome = await this.boundedOp(`PUT ${closureHash}`, async (signal) => {
      const res = await this.fetchImpl(url, {
        method: 'PUT',
        headers: { ...sendHeaders, authorization },
        body: bundleToStore.bytes as unknown as BodyInit,
        signal,
      });
      if (!res.ok) {
        if (conditionalCreate && isCreatePreconditionFailure(res.status)) {
          discardBody(res);
          return 'race-lost' as const;
        }
        const snippet = await readErrorSnippet(res);
        throw new Error(
          `eddy: bundle store PUT ${closureHash} failed: HTTP ${res.status} ${snippet.slice(0, 200)}`,
        );
      }
      discardBody(res);
      return 'stored' as const;
    });
    if (putOutcome === 'race-lost') {
      const raced = await this.boundedOp(
        `GET ${closureHash} (create race proof)`,
        async (signal) => {
          const res = await this.fetchImpl(url, { signal });
          if (!res.ok) {
            discardBody(res);
            throw new Error(`HTTP ${res.status}`);
          }
          return {
            cacheControl: res.headers.get('cache-control'),
            bytes: await readBodyBounded(
              res,
              this.opts.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES,
              `GET ${closureHash} (create race proof)`,
            ),
          };
        },
      ).catch((err) => {
        throw new Error(
          `eddy: bundle store PUT ${closureHash} lost a create race and the existing object could not be verified: ${errMsg(err)}`,
        );
      });
      const verified = await this.verifyContentAddress(closureHash, raced.bytes);
      if (!verified) {
        throw new Error(
          `eddy: bundle store PUT ${closureHash} lost a create race but the existing object is not a valid bundle`,
        );
      }
      if (raced.cacheControl !== CACHE_CONTROL_IMMUTABLE) {
        throw new Error(
          `eddy: bundle store PUT ${closureHash} lost a create race but the existing object serves Cache-Control ` +
            `${JSON.stringify(raced.cacheControl)} — not the immutable metadata the CDN tier depends on`,
        );
      }
      return;
    }
    // A settled put PROMISES GET-by-hash servability (bundle-store.ts contract)
    // — but the signed PUT succeeding says nothing about the UNSIGNED public
    // read path (a private/mis-ACL'd bucket 403s it, and the CDN + clients
    // read unsigned). Prove it — the BYTES and the METADATA: a provider/proxy
    // that accepts the PUT but strips/ignores `Cache-Control` would publish a
    // link the CDN/browser tier can't hold, silently defeating ADR-0194 §4.
    // Cheap byte path: a public HEAD whose ETag is the single-part MD5
    // (Yandex/AWS default). An ETag that is NOT the body MD5 (bucket
    // encryption, multipart, provider-specific) proves nothing either way, so
    // fall back to an unsigned GET + byte-hash compare — otherwise a perfectly
    // served object would fail the proof forever (recompute loop). Throwing
    // routes into the cache's degrade path (no mutable link is published for
    // an unservable hash).
    const proof = await this.boundedOp(`HEAD ${closureHash} (put proof)`, async (signal) => {
      const res = await this.fetchImpl(url, { method: 'HEAD', signal });
      discardBody(res);
      return {
        ok: res.ok,
        status: res.status,
        etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
        cacheControl: res.headers.get('cache-control'),
      };
    }).catch((err) => {
      throw new Error(
        `eddy: bundle store PUT ${closureHash} succeeded but the public-read HEAD failed: ${errMsg(err)}`,
      );
    });
    if (!proof.ok) {
      throw new Error(
        `eddy: bundle store PUT ${closureHash} succeeded but the object is not publicly readable ` +
          `(HEAD ${proof.status}) — is the bucket public-read?`,
      );
    }
    if (proof.cacheControl !== CACHE_CONTROL_IMMUTABLE) {
      throw new Error(
        `eddy: bundle store PUT ${closureHash} succeeded but the public read serves Cache-Control ` +
          `${JSON.stringify(proof.cacheControl)} — not the immutable metadata the CDN tier depends on`,
      );
    }
    if (proof.etag === bodyMd5Hex) return; // MD5 ETag proves the exact bytes
    const served = await this.boundedOp(`GET ${closureHash} (put proof)`, async (signal) => {
      const res = await this.fetchImpl(url, { signal });
      if (!res.ok) {
        discardBody(res);
        throw new Error(
          `eddy: bundle store PUT ${closureHash} succeeded but the object is not publicly readable ` +
            `(GET ${res.status}) — is the bucket public-read?`,
        );
      }
      return readBodyBounded(
        res,
        this.opts.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES,
        `GET ${closureHash} (put proof)`,
      );
    }).catch((err) => {
      if (err instanceof Error && /not publicly readable/.test(err.message)) throw err;
      throw new Error(
        `eddy: bundle store PUT ${closureHash} succeeded but the public-read GET failed: ${errMsg(err)}`,
      );
    });
    const servedSha = createHash('sha256').update(served).digest('hex');
    if (servedSha !== payloadSha256Hex) {
      throw new Error(
        `eddy: bundle store PUT ${closureHash} read back DIFFERENT bytes — the public path serves a foreign object`,
      );
    }
  }
}

/** The manifest fields {@link S3BundleStore.verifyContentAddress} dereferences
 * — a parseable-but-malformed object (missing `asOf`, junk `tarballs`) must
 * fail HERE as a miss, not throw mid-verification into a GET 500. */
function manifestShapeOk(manifest: unknown): manifest is {
  npmClientVersion: string;
  asOf: { resolvedAt: string; registry: string; closureHash: string };
  tarballs: Array<{ file: string; name: string; version: string; integrity: string }>;
} {
  const m = manifest as {
    npmClientVersion?: unknown;
    asOf?: { resolvedAt?: unknown; registry?: unknown; closureHash?: unknown };
    tarballs?: unknown;
  } | null;
  if (!m || typeof m !== 'object') return false;
  if (typeof m.npmClientVersion !== 'string') return false;
  if (
    !m.asOf ||
    typeof m.asOf !== 'object' ||
    typeof m.asOf.resolvedAt !== 'string' ||
    typeof m.asOf.registry !== 'string' ||
    typeof m.asOf.closureHash !== 'string'
  ) {
    return false;
  }
  if (!Array.isArray(m.tarballs)) return false;
  return m.tarballs.every(
    (t: { file?: unknown; name?: unknown; version?: unknown; integrity?: unknown }) =>
      !!t &&
      typeof t === 'object' &&
      typeof t.file === 'string' &&
      typeof t.name === 'string' &&
      typeof t.version === 'string' &&
      typeof t.integrity === 'string',
  );
}

function isCreatePreconditionFailure(status: number): boolean {
  return status === 409 || status === 412;
}

/** Fire-and-forget body discard: releases the connection without buffering. */
function discardBody(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/**
 * Read a body fully, CANCELLING + throwing past `cap` — an over-cap object is
 * junk (no client would accept it), not data worth buffering.
 */
async function readBodyBounded(res: Response, cap: number, what: string): Promise<Uint8Array> {
  const body = res.body;
  if (!body) return new Uint8Array(await res.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      throw new Error(`eddy: bundle store ${what} body exceeded the ${cap}-byte cap`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Best-effort error-body snippet: at most {@link ERROR_SNIPPET_BYTES}, then
 * cancel — an error body must never buffer like an object. */
async function readErrorSnippet(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < ERROR_SNIPPET_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      // Slice to the REMAINING cap — one big first chunk must not buffer whole.
      const chunk = value.subarray(0, ERROR_SNIPPET_BYTES - size);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } catch {
    // partial snippet is fine
  }
  void reader.cancel().catch(() => {});
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** `YYYYMMDD'T'HHMMSS'Z'` (UTC). */
function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}
