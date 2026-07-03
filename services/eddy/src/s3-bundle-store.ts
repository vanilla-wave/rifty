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
import { type EddyBundleManifestV1, unpackEddyBundle } from '@riftydev/npm-client';
import type { BundleStore } from './bundle-store.ts';
import type { CachedBundle } from './cache.ts';
import { signV4 } from './sigv4.ts';

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
    let manifest: EddyBundleManifestV1;
    try {
      manifest = unpackEddyBundle(bytes).manifest;
    } catch (err) {
      // A truncated/foreign object must read as a miss, not a served corrupt
      // bundle — the compute-path put() (§put) then re-seeds the key.
      console.error(
        `eddy: bundle store object for ${closureHash} is not a valid bundle: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    // Content-addressed invariant: the object at `bundle/<hash>` MUST be the
    // bundle whose closure IS that hash. A mismatch (a valid bundle mis-keyed by
    // a bad upload) reads as a miss, never served under the wrong key — put()
    // re-seeds the correct bytes.
    if (manifest.asOf.closureHash !== closureHash) {
      console.error(
        `eddy: bundle store object at ${closureHash} carries a different closure hash ${manifest.asOf.closureHash} — treating as a miss`,
      );
      return null;
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
    const bodyMd5Hex = createHash('md5').update(bundle.bytes).digest('hex');
    const head = await this.fetchImpl(url, { method: 'HEAD' }).catch(() => null);
    if (head) {
      await head.arrayBuffer().catch(() => undefined); // drain (empty by spec)
      if (head.ok && (head.headers.get('etag') ?? '').replace(/"/g, '') === bodyMd5Hex) {
        return; // identical object already durable — no re-upload
      }
    }
    const payloadSha256Hex = createHash('sha256').update(bundle.bytes).digest('hex');
    const amzDate = toAmzDate(this.opts.now ? this.opts.now() : new Date());
    const headers: Record<string, string> = {
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
