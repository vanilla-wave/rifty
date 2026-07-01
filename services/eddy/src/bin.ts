#!/usr/bin/env node
/**
 * `npx @riftydev/eddy` — start the resolver service. Config via env (D-004
 * style at the server boundary): `PORT` (default 8788), `REGISTRY_BASE_URL`
 * (the upstream registry; npmjs default, mirroring the bake-snapshots tool),
 * `EDDY_TTL_SECONDS` (mutable-tier TTL; 0 = always recompute).
 */
import { parseTtlSeconds } from './env.ts';
import { createEddyServer } from './server.ts';

const port = Number(process.env.PORT ?? '8788');
const registryBaseUrl = process.env.REGISTRY_BASE_URL ?? 'https://registry.npmjs.org';
// Throws loudly on a junk value (`abc`, `30s`) rather than coercing to NaN and
// silently disabling the mutable-tier cache.
const ttlSeconds = parseTtlSeconds(process.env.EDDY_TTL_SECONDS);

const server = createEddyServer({ registryBaseUrl, ttlSeconds });
server.listen(port, '0.0.0.0').then(() => {
  console.log(`@riftydev/eddy listening on :${port} → upstream registry ${registryBaseUrl}`);
});
