#!/usr/bin/env node
// Live smoke for the eddy fast-install resolver (ADR-0182), mirroring
// tools/registry/smoke-npm-registry.mjs. POST a dep-set → assert a streamed
// EddyBundleV1 tar with the as-of `x-eddy-*` headers and the cross-origin
// headers the browser client needs (the playground fetches eddy cross-origin
// from a COEP-isolated Worker). Wired into .github/workflows/netlify.yml.

const baseUrl = process.argv[2];
if (baseUrl === undefined || baseUrl.length === 0) {
  console.error('Usage: smoke-eddy.mjs <base-url>');
  process.exit(2);
}

let lastError = new Error('smoke did not run');

for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: '^4.4.1' } }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/x-tar')) {
      throw new Error(`expected application/x-tar, got ${contentType}`);
    }
    // Cross-origin headers — without these the browser blocks the response.
    if (response.headers.get('access-control-allow-origin') !== '*') {
      throw new Error('missing Access-Control-Allow-Origin: *');
    }
    if (response.headers.get('cross-origin-resource-policy') !== 'cross-origin') {
      throw new Error('missing Cross-Origin-Resource-Policy: cross-origin');
    }
    // As-of stamp (ADR-0182).
    for (const h of ['x-eddy-resolved-at', 'x-eddy-closure-hash', 'x-eddy-npm-client-version']) {
      if (!response.headers.get(h)) throw new Error(`missing ${h} header`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 512) throw new Error(`tar too small (${bytes.length} bytes)`);
    // ustar magic at byte offset 257, or the first entry name at offset 0.
    const firstName = new TextDecoder().decode(bytes.subarray(0, 100)).replace(/\0+$/, '');
    if (firstName.length === 0) throw new Error('empty first tar entry name');

    console.log(
      `eddy smoke ok: ${baseUrl} → ${bytes.length} bytes, first entry "${firstName}", ` +
        `closure ${response.headers.get('x-eddy-closure-hash')}, ` +
        `npm-client ${response.headers.get('x-eddy-npm-client-version')}`,
    );
    process.exit(0);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    if (attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

console.error(`eddy resolver smoke failed: ${lastError.message}`);
process.exit(1);
