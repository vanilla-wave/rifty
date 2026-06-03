// @riftydev/npm-client — resolving a version from a registry packument. The registry
// client takes an injected `fetch` (no hardcoded URL, D-004), so this example is
// deterministic and offline. Run: `pnpm --filter @rifty-examples/standalone registry`.
import { type Fetcher, RegistryClient, pickBestVersion } from '@riftydev/npm-client';

// A tiny stub packument — in a real app this is `globalThis.fetch` hitting the
// registry (or a proxy). The shape mirrors what npm returns.
const packument = {
  name: 'left-pad',
  'dist-tags': { latest: '1.3.0' },
  versions: {
    '1.0.0': { name: 'left-pad', version: '1.0.0' },
    '1.2.0': { name: 'left-pad', version: '1.2.0' },
    '1.3.0': { name: 'left-pad', version: '1.3.0' },
  },
};

const fetch: Fetcher = async () =>
  new Response(JSON.stringify(packument), { headers: { 'content-type': 'application/json' } });

const client = new RegistryClient({ fetch });
const pkgmt = await client.getPackument('left-pad');

console.log('versions   :', Object.keys(pkgmt.versions));
console.log('best ^1.1.0:', pickBestVersion(Object.keys(pkgmt.versions), '^1.1.0')); // 1.3.0
