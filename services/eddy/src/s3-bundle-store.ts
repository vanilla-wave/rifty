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
 */
import { createHash } from 'node:crypto';
import {
  type EddyBundleContents,
  type Lockfile,
  closureHashOf,
  computeIntegrity,
  parseIntegrityAlgorithm,
  unpackEddyBundle,
} from '@riftydev/npm-client';
import type { BundleStore } from './bundle-store.ts';
import type { CachedBundle } from './cache.ts';
import { signV4 } from './sigv4.ts';

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';

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

  async get(closureHash: string): Promise<CachedBundle | null> {
    const res = await this.fetchImpl(this.urlFor(closureHash));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`eddy: bundle store GET ${closureHash} failed: HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
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
    let contents: EddyBundleContents;
    try {
      contents = unpackEddyBundle(bytes);
    } catch (err) {
      console.error(
        `eddy: bundle store object for ${closureHash} is not a valid bundle: ${errMsg(err)}`,
      );
      return null;
    }
    const { manifest, lockfileText, tarballs } = contents;
    if (manifest.asOf.closureHash !== closureHash) {
      console.error(
        `eddy: bundle store object at ${closureHash} carries a different closure hash ${manifest.asOf.closureHash} — treating as a miss`,
      );
      return null;
    }
    let derived: string;
    try {
      derived = await closureHashOf(JSON.parse(lockfileText) as Lockfile);
    } catch (err) {
      console.error(
        `eddy: bundle store object for ${closureHash} has an unparseable lockfile: ${errMsg(err)}`,
      );
      return null;
    }
    if (derived !== closureHash) {
      console.error(
        `eddy: bundle store object at ${closureHash} re-derives to ${derived} from its lockfile — treating as a miss`,
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
    // already durable → skip the upload. A missing OR non-matching object
    // (truncated/foreign/mis-keyed, all of which get() reads as a miss) → PUT,
    // overwriting the poisoned key so GET-by-hash heals. A non-MD5 ETag (bucket
    // default-encryption, multipart) never matches → we re-upload, a safe degrade.
    // Skip ONLY when the metadata is ALSO already immutable — an existing
    // same-byte object missing the `Cache-Control` header (an older upload) still
    // gets re-PUT to repair the metadata the CDN path depends on.
    const bodyMd5Hex = createHash('md5').update(bundle.bytes).digest('hex');
    const head = await this.fetchImpl(url, { method: 'HEAD' }).catch(() => null);
    if (head) {
      await head.arrayBuffer().catch(() => undefined); // drain (empty by spec)
      const etagMatch = (head.headers.get('etag') ?? '').replace(/"/g, '') === bodyMd5Hex;
      const immutable = head.headers.get('cache-control') === CACHE_CONTROL_IMMUTABLE;
      if (head.ok && etagMatch && immutable) {
        return; // identical object already durable WITH the immutable header — no re-upload
      }
    }
    const payloadSha256Hex = createHash('sha256').update(bundle.bytes).digest('hex');
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
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { ...sendHeaders, authorization },
      body: bundle.bytes as unknown as BodyInit,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `eddy: bundle store PUT ${closureHash} failed: HTTP ${res.status} ${body.slice(0, 200)}`,
      );
    }
    await res.arrayBuffer().catch(() => undefined);
  }
}

/** `YYYYMMDD'T'HHMMSS'Z'` (UTC). */
function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}
