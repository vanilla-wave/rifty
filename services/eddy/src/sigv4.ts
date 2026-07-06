/**
 * Hand-rolled AWS Signature V4 — the PUT path of `S3BundleStore` only
 * (ADR-0194 §4: one signed request type doesn't justify an SDK dependency
 * tree). Regression-locked to the published AWS example vectors in
 * `s3-bundle-store.test.ts`.
 *
 * S3 specifics honored here: the canonical URI is the RAW request path exactly
 * as sent (S3 verifies against it without normalization or double-encoding) —
 * the caller passes an already-percent-encoded path.
 */
import { createHash, createHmac } from 'node:crypto';

export interface SignV4Options {
  method: string;
  /** Raw request path as sent on the wire (already percent-encoded). */
  path: string;
  /** Canonical query string ('' when none). */
  query?: string;
  /** Headers to sign — MUST include `host` and `x-amz-date`. */
  headers: Record<string, string>;
  /** Hex sha256 of the payload (also sent as `x-amz-content-sha256`). */
  payloadSha256Hex: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** `YYYYMMDD'T'HHMMSS'Z'` — must equal the `x-amz-date` header value. */
  amzDate: string;
}

/** Build the `Authorization` header value for the request. */
export function signV4(opts: SignV4Options): string {
  const names = Object.keys(opts.headers)
    .map((n) => n.toLowerCase())
    .sort();
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(opts.headers)) {
    lower[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    opts.method,
    opts.path,
    opts.query ?? '',
    canonicalHeaders,
    signedHeaders,
    opts.payloadSha256Hex,
  ].join('\n');

  const dateStamp = opts.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    opts.amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${opts.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(opts.region).digest();
  const kService = createHmac('sha256', kRegion).update(opts.service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
}
