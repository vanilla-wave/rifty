#!/usr/bin/env node
/**
 * `npx @riftydev/eddy` — start the resolver service. Config via env (D-004
 * style at the server boundary): `PORT` (default 8788), `REGISTRY_BASE_URL`
 * (the upstream registry; npmjs default, mirroring the bake-snapshots tool),
 * `EDDY_TTL_SECONDS` (mutable-tier TTL; 0 = always recompute),
 * `EDDY_PACKUMENT_TTL_SECONDS` (shared packument cache; default 300, 0 = off),
 * `EDDY_TARBALL_CACHE_MAX_BYTES`, `EDDY_BUNDLE_MEMORY_MAX_BYTES`, and the
 * `EDDY_S3_*` group (all-or-none) selecting the Object-Storage bundle store
 * (ADR-0194). All parsers throw loudly on junk instead of coercing to NaN and
 * silently disabling the cache they configure.
 */
import { MemoryBundleStore } from './bundle-store.ts';
import { parseByteCount, parsePort, parseS3Config, parseTtlSeconds } from './env.ts';
import { S3BundleStore } from './s3-bundle-store.ts';
import { createEddyServer } from './server.ts';

const port = parsePort(process.env.PORT) ?? 8788;
const registryBaseUrl = process.env.REGISTRY_BASE_URL ?? 'https://registry.npmjs.org';
const ttlSeconds = parseTtlSeconds(process.env.EDDY_TTL_SECONDS);
const packumentTtlSeconds = parseTtlSeconds(
  process.env.EDDY_PACKUMENT_TTL_SECONDS,
  'EDDY_PACKUMENT_TTL_SECONDS',
);
const tarballCacheMaxBytes = parseByteCount(
  process.env.EDDY_TARBALL_CACHE_MAX_BYTES,
  'EDDY_TARBALL_CACHE_MAX_BYTES',
);
const bundleMemoryMaxBytes = parseByteCount(
  process.env.EDDY_BUNDLE_MEMORY_MAX_BYTES,
  'EDDY_BUNDLE_MEMORY_MAX_BYTES',
);
const s3 = parseS3Config(process.env);
const store = s3
  ? new S3BundleStore(s3)
  : new MemoryBundleStore(
      bundleMemoryMaxBytes === undefined ? {} : { maxBytes: bundleMemoryMaxBytes },
    );

const server = createEddyServer({
  registryBaseUrl,
  ttlSeconds,
  packumentTtlSeconds,
  tarballCacheMaxBytes,
  store,
});
server
  .listen(port, '0.0.0.0')
  .then(() => {
    const storeLabel = s3 ? `s3 ${s3.endpoint}/${s3.bucket}` : 'memory';
    console.log(
      `@riftydev/eddy listening on :${port} → upstream registry ${registryBaseUrl}, bundle store: ${storeLabel}`,
    );
  })
  .catch((err: unknown) => {
    console.error(
      `@riftydev/eddy failed to listen on :${port}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
